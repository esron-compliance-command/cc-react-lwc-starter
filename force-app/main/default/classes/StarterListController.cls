/**
 * @description The server side of the React grid, and a deliberately small model of how the real
 *              CCDataGridController works.
 *
 * ONE controller, generic over the object, is the entire point. Adding a second list to this app is
 * a handful of Starter_Grid_Column__mdt records and a permission -- not a new Apex class, not a new
 * LWC, not a new React component. Every time you are tempted to write FooListController, ask what
 * configuration would have made this class handle Foo already.
 *
 * Security posture -- read this part twice, it is the part reviewers will not bend on:
 *  - `with sharing`, so org sharing rules apply to every query.
 *  - Every query runs at AccessLevel.USER_MODE, which THROWS on an object or field the running user
 *    cannot read rather than quietly returning it. Note that USER_MODE governs CRUD and FLS only --
 *    it is not record sharing, and the two are separate gates that fail in different ways.
 *  - Sortable and searchable fields are drawn ONLY from the caller's own metadata configuration. A
 *    request can never sort or search on an arbitrary field name it invents. That, not string
 *    escaping, is what makes dynamic SOQL safe here.
 *  - Rows are serialized as plain maps keyed by the CONFIGURED api name, never as SObjects, so the
 *    client never has to know which namespace prefix the running org happens to use.
 */
public with sharing class StarterListController {
    private static final Integer MAX_PAGE_SIZE = 100;
    private static final Integer DEFAULT_PAGE_SIZE = 10;
    // SOQL refuses an OFFSET beyond 2000 rows. Deep paging therefore needs a keyset ("where Id >
    // lastId") strategy rather than a bigger offset -- out of scope here, but know the ceiling
    // exists before a customer with 50,000 records finds it for you.
    private static final Integer MAX_OFFSET = 2000;

    /**
     * The request, mirrored field-for-field by ListRequest in components/types.ts. When you add a
     * field here, add it there in the same commit.
     */
    public class ListRequest {
        public String objectApiName;
        public String search;
        // NOT `sort`: Apex reserves that identifier (List.sort()), and the compiler rejects it as
        // a member name. The client sends `sortState` for the same reason -- a small, real example
        // of a platform constraint reaching all the way out into the JSON contract.
        public SortState sortState;
        public Integer pageNumber;
        public Integer pageSize;
    }

    public class SortState {
        public String apiName;
        public String direction;
    }

    /** One resolved, readable, configured column. */
    private class ResolvedColumn {
        String apiName; // as configured, unprefixed -- this is the key the client sees
        String queryName; // as the schema really calls it, namespace and all
        String label;
        String clientType;
        Boolean sortable;
        Boolean searchable;
        Schema.DisplayType displayType;
    }

    /**
     * @description Returns one page of records for any configured object.
     * @param requestJson A serialized ListRequest. A JSON string rather than typed parameters so the
     *        request can grow without changing this signature or the LWC that calls it.
     * @return A serialized envelope: columns, rows, totalCount, pageNumber, pageSize.
     */
    @AuraEnabled(cacheable=false)
    public static String fetchList(String requestJson) {
        try {
            ListRequest request = (ListRequest) JSON.deserialize(requestJson, ListRequest.class);
            if (String.isBlank(request.objectApiName)) {
                throw new StarterListException('No object was requested.');
            }

            SObjectType sObjType = resolveSObjectType(request.objectApiName);
            List<ResolvedColumn> columns = resolveColumns(request.objectApiName, sObjType);

            Integer pageSize = normalizePageSize(request.pageSize);
            Integer pageNumber = request.pageNumber == null || request.pageNumber < 1 ? 1 : request.pageNumber;
            Integer offset = (pageNumber - 1) * pageSize;
            if (offset > MAX_OFFSET) {
                throw new StarterListException(
                    'That page is beyond the ' + MAX_OFFSET + ' record limit SOQL allows. Narrow the list with a search.'
                );
            }

            // The filter binds are shared by both queries; the paging binds belong only to the page
            // query. Keep them in separate maps -- a bind map carrying variables the query never
            // references is a needless way to make a query fail.
            Map<String, Object> filterBinds = new Map<String, Object>();
            String whereClause = buildWhereClause(columns, request.search, filterBinds);
            String objectName = sObjType.getDescribe().getName();

            Map<String, Object> pageBinds = new Map<String, Object>(filterBinds);
            pageBinds.put('pageSize', pageSize);
            pageBinds.put('recordOffset', offset);

            String soql =
                'SELECT ' + String.join(queryFieldNames(columns), ', ') +
                ' FROM ' + objectName +
                whereClause +
                buildOrderBy(columns, request.sortState) +
                ' LIMIT :pageSize OFFSET :recordOffset';

            List<SObject> records = Database.queryWithBinds(soql, pageBinds, AccessLevel.USER_MODE);

            // COUNT() is a second query on purpose: the page query's LIMIT means its size tells you
            // nothing about how many records actually match. Note that WITH SECURITY_ENFORCED is not
            // allowed on a COUNT() at all -- USER_MODE covers both queries, which is why it is used.
            String countSoql = 'SELECT COUNT() FROM ' + objectName + whereClause;
            Integer totalCount = Database.countQueryWithBinds(countSoql, filterBinds, AccessLevel.USER_MODE);

            return JSON.serialize(new Map<String, Object>{
                'columns' => describeColumnsForClient(columns),
                'rows' => toClientRows(records, columns),
                'totalCount' => totalCount,
                'pageNumber' => pageNumber,
                'pageSize' => pageSize
            });
        } catch (Exception e) {
            // AuraHandledException's constructor alone leaves body.message EMPTY on the client, and
            // the user sees the useless "An error occurred while trying to update the record."
            // setMessage is what actually carries the text across. This catches everyone once.
            AuraHandledException handled = new AuraHandledException(e.getMessage());
            handled.setMessage(e.getMessage());
            throw handled;
        }
    }

    // ---------------------------------------------------------------- resolution

    /**
     * Resolves an object by API name without assuming a namespace.
     *
     * In a packaged org the same object may be Starter__c, cocmd__Starter__c or coqa__Starter__c
     * depending on where the code is running. Configuration stores the bare name; the schema knows
     * the real one. Never hardcode a prefix.
     */
    private static SObjectType resolveSObjectType(String objectApiName) {
        // Held in a local: getGlobalDescribe() is one of the most expensive calls in Apex, and
        // calling it inside a loop is a classic way to blow the CPU limit on a large org.
        Map<String, SObjectType> globalDescribe = Schema.getGlobalDescribe();

        SObjectType direct = globalDescribe.get(objectApiName);
        if (direct != null) {
            return direct;
        }
        String suffix = ('__' + objectApiName).toLowerCase();
        for (String key : globalDescribe.keySet()) {
            if (key.endsWith(suffix)) {
                return globalDescribe.get(key);
            }
        }
        throw new StarterListException('Unknown object: ' + objectApiName);
    }

    private static List<ResolvedColumn> resolveColumns(String objectApiName, SObjectType sObjType) {
        Map<String, Schema.SObjectField> fieldsByName = sObjType.getDescribe().fields.getMap();
        List<ResolvedColumn> resolved = new List<ResolvedColumn>();

        for (Starter_Grid_Column__mdt config : [
            SELECT Field_API_Name__c, Column_Label__c, Is_Sortable__c, Is_Searchable__c
            FROM Starter_Grid_Column__mdt
            WHERE Object_API_Name__c = :objectApiName
            ORDER BY Sort_Order__c ASC NULLS LAST
        ]) {
            Schema.SObjectField field = findField(fieldsByName, config.Field_API_Name__c);
            if (field == null) {
                // Configuration drifts from the schema -- a renamed field, a typo. Skip the column
                // rather than fail the entire list for every user because of one bad row.
                continue;
            }
            Schema.DescribeFieldResult describe = field.getDescribe();
            if (!describe.isAccessible()) {
                continue; // the running user cannot see it; do not even put it in the SELECT
            }

            ResolvedColumn column = new ResolvedColumn();
            column.apiName = config.Field_API_Name__c;
            column.queryName = describe.getName();
            column.label = String.isBlank(config.Column_Label__c) ? describe.getLabel() : config.Column_Label__c;
            column.displayType = describe.getType();
            column.clientType = toClientType(describe.getType());
            column.sortable = config.Is_Sortable__c == true && describe.isSortable();
            column.searchable = config.Is_Searchable__c == true && isTextLike(describe.getType());
            resolved.add(column);
        }

        if (resolved.isEmpty()) {
            throw new StarterListException(
                'No columns are configured for ' + objectApiName +
                '. Add Starter_Grid_Column__mdt records, then deploy them.'
            );
        }
        return resolved;
    }

    /** Matches a configured bare name against the schema's real, possibly namespaced, name. */
    private static Schema.SObjectField findField(Map<String, Schema.SObjectField> fieldsByName, String apiName) {
        if (String.isBlank(apiName)) {
            return null;
        }
        String lower = apiName.toLowerCase();
        if (fieldsByName.containsKey(lower)) {
            return fieldsByName.get(lower);
        }
        String suffix = '__' + lower;
        for (String key : fieldsByName.keySet()) {
            if (key.endsWith(suffix)) {
                return fieldsByName.get(key);
            }
        }
        return null;
    }

    // ---------------------------------------------------------------- query building

    private static List<String> queryFieldNames(List<ResolvedColumn> columns) {
        List<String> names = new List<String>{ 'Id' };
        for (ResolvedColumn column : columns) {
            if (column.queryName != 'Id') {
                names.add(column.queryName);
            }
        }
        return names;
    }

    /**
     * Builds the WHERE clause with BOUND variables, never string concatenation of user input.
     *
     * The field names interpolated into this string come from configuration, not from the request,
     * which is the actual defence against SOQL injection. The search TERM is bound.
     */
    private static String buildWhereClause(
        List<ResolvedColumn> columns,
        String search,
        Map<String, Object> binds
    ) {
        if (String.isBlank(search)) {
            return '';
        }
        List<String> clauses = new List<String>();
        for (ResolvedColumn column : columns) {
            if (column.searchable) {
                clauses.add(column.queryName + ' LIKE :searchTerm');
            }
        }
        if (clauses.isEmpty()) {
            return '';
        }
        binds.put('searchTerm', '%' + escapeLikeWildcards(search.trim()) + '%');
        return ' WHERE (' + String.join(clauses, ' OR ') + ')';
    }

    /**
     * A user typing "50%" must search for the literal characters, not "anything starting with 50".
     * Underscore is a single-character wildcard in SOQL LIKE and catches people out constantly.
     */
    private static String escapeLikeWildcards(String term) {
        return term.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_');
    }

    private static String buildOrderBy(List<ResolvedColumn> columns, SortState requested) {
        if (requested == null || String.isBlank(requested.apiName)) {
            return ' ORDER BY ' + columns[0].queryName + ' ASC NULLS LAST';
        }
        for (ResolvedColumn column : columns) {
            if (column.apiName == requested.apiName && column.sortable) {
                String direction = requested.direction == 'desc' ? 'DESC' : 'ASC';
                return ' ORDER BY ' + column.queryName + ' ' + direction + ' NULLS LAST';
            }
        }
        // An unsortable or unknown field is IGNORED, not honoured. Silently accepting it is how an
        // arbitrary field name reaches the query.
        return ' ORDER BY ' + columns[0].queryName + ' ASC NULLS LAST';
    }

    private static Integer normalizePageSize(Integer requested) {
        if (requested == null || requested < 1) {
            return DEFAULT_PAGE_SIZE;
        }
        return Math.min(requested, MAX_PAGE_SIZE);
    }

    // ---------------------------------------------------------------- serialization

    private static List<Map<String, Object>> describeColumnsForClient(List<ResolvedColumn> columns) {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (ResolvedColumn column : columns) {
            out.add(new Map<String, Object>{
                'apiName' => column.apiName,
                'label' => column.label,
                'type' => column.clientType,
                'sortable' => column.sortable
            });
        }
        return out;
    }

    /**
     * Turns SObjects into plain maps keyed by the CONFIGURED api name.
     *
     * This is the namespace firewall. Serialize an SObject straight to the client and every custom
     * field arrives as cocmd__Status__c in production and coqa__Status__c in QA -- so client code
     * written against one silently renders blank in the other. Here the client always sees Status__c.
     */
    private static List<Map<String, Object>> toClientRows(
        List<SObject> records,
        List<ResolvedColumn> columns
    ) {
        List<Map<String, Object>> rows = new List<Map<String, Object>>();
        for (SObject record : records) {
            Map<String, Object> row = new Map<String, Object>{ 'Id' => record.Id };
            for (ResolvedColumn column : columns) {
                row.put(column.apiName, record.get(column.queryName));
            }
            rows.add(row);
        }
        return rows;
    }

    private static String toClientType(Schema.DisplayType type) {
        switch on type {
            when CURRENCY, DOUBLE, INTEGER, LONG, PERCENT {
                return 'number';
            }
            when DATE {
                return 'date';
            }
            when DATETIME {
                return 'datetime';
            }
            when BOOLEAN {
                return 'boolean';
            }
            when REFERENCE, ID {
                return 'reference';
            }
            when else {
                return 'text';
            }
        }
    }

    private static Boolean isTextLike(Schema.DisplayType type) {
        return type == Schema.DisplayType.STRING ||
            type == Schema.DisplayType.TEXTAREA ||
            type == Schema.DisplayType.EMAIL ||
            type == Schema.DisplayType.PHONE ||
            type == Schema.DisplayType.URL ||
            type == Schema.DisplayType.PICKLIST;
    }

    public class StarterListException extends Exception {}
}
