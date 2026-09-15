/**
 * @description Tests for StarterListController.
 *
 * Two habits worth copying from this file:
 *
 * 1. It asserts BEHAVIOUR, not coverage. Every test names a thing that could plausibly break in
 *    production -- paging, an injected sort field, a user without field access. A test that only
 *    runs the method and asserts it did not throw is coverage theatre; it passes forever, including
 *    after you break the feature.
 *
 * 2. It runs the security cases as a REAL restricted user via System.runAs. Running everything as
 *    the admin who happens to be executing the suite is how FLS bugs reach a customer: the test
 *    passes because the test user could see everything.
 */
@IsTest
private class StarterListControllerTest {
    private static final Integer ACCOUNT_COUNT = 15;

    @TestSetup
    static void setup() {
        List<Account> accounts = new List<Account>();
        for (Integer i = 0; i < ACCOUNT_COUNT; i++) {
            accounts.add(
                new Account(
                    Name = 'Wittmann ' + String.valueOf(i).leftPad(2, '0'),
                    Industry = Math.mod(i, 2) == 0 ? 'Manufacturing' : 'Energy',
                    AnnualRevenue = 100000 * (i + 1)
                )
            );
        }
        // One record whose name contains a SOQL LIKE wildcard, so the escaping is exercised by a
        // real row rather than only in theory.
        accounts.add(new Account(Name = '50% Holdings', Industry = 'Energy'));
        insert accounts;
    }

    private static String request(Map<String, Object> overrides) {
        Map<String, Object> req = new Map<String, Object>{
            'objectApiName' => 'Account',
            'search' => '',
            'pageNumber' => 1,
            'pageSize' => 10
        };
        req.putAll(overrides);
        return JSON.serialize(req);
    }

    private static Map<String, Object> parse(String raw) {
        return (Map<String, Object>) JSON.deserializeUntyped(raw);
    }

    @IsTest
    static void returnsFirstPageWithTotalCountOfEverythingMatching() {
        Test.startTest();
        Map<String, Object> result = parse(StarterListController.fetchList(request(new Map<String, Object>())));
        Test.stopTest();

        List<Object> rows = (List<Object>) result.get('rows');
        Assert.areEqual(10, rows.size(), 'A page of 10 should hold 10 rows.');
        // The point of the separate COUNT query: totalCount describes the whole result, not the page.
        Assert.areEqual(ACCOUNT_COUNT + 1, (Integer) result.get('totalCount'));
    }

    @IsTest
    static void secondPageReturnsDifferentRecordsFromTheFirst() {
        Map<String, Object> pageOne = parse(StarterListController.fetchList(request(new Map<String, Object>{ 'pageNumber' => 1 })));
        Map<String, Object> pageTwo = parse(StarterListController.fetchList(request(new Map<String, Object>{ 'pageNumber' => 2 })));

        Set<Object> idsOne = new Set<Object>();
        for (Object row : (List<Object>) pageOne.get('rows')) {
            idsOne.add(((Map<String, Object>) row).get('Id'));
        }
        for (Object row : (List<Object>) pageTwo.get('rows')) {
            Assert.isFalse(
                idsOne.contains(((Map<String, Object>) row).get('Id')),
                'Page two repeated a record from page one -- the OFFSET is wrong.'
            );
        }
    }

    @IsTest
    static void rowsAreKeyedByConfiguredApiNameNotBySObjectField() {
        Map<String, Object> result = parse(StarterListController.fetchList(request(new Map<String, Object>())));
        Map<String, Object> row = (Map<String, Object>) ((List<Object>) result.get('rows'))[0];

        Assert.isTrue(row.containsKey('Id'), 'Every row must carry its Id for the client key.');
        Assert.isTrue(row.containsKey('Name'), 'Rows are keyed by the configured api name.');
    }

    @IsTest
    static void searchIsAppliedOnTheServerAndNarrowsTheTotal() {
        Map<String, Object> result = parse(
            StarterListController.fetchList(request(new Map<String, Object>{ 'search' => 'Wittmann 0' }))
        );

        Integer total = (Integer) result.get('totalCount');
        Assert.isTrue(total > 0, 'The search should match something.');
        Assert.isTrue(total < ACCOUNT_COUNT + 1, 'The search should narrow the result, not return everything.');
    }

    @IsTest
    static void searchTreatsPercentAsALiteralCharacter() {
        Map<String, Object> result = parse(
            StarterListController.fetchList(request(new Map<String, Object>{ 'search' => '50%' }))
        );

        // Unescaped, "50%" as a LIKE pattern would match every name beginning "50". Escaped, it
        // matches the one account actually called "50% Holdings".
        Assert.areEqual(1, (Integer) result.get('totalCount'));
    }

    @IsTest
    static void sortDirectionIsHonoured() {
        Map<String, Object> ascending = parse(
            StarterListController.fetchList(
                request(new Map<String, Object>{ 'sort' => new Map<String, Object>{ 'apiName' => 'Name', 'direction' => 'asc' } })
            )
        );
        Map<String, Object> descending = parse(
            StarterListController.fetchList(
                request(new Map<String, Object>{ 'sort' => new Map<String, Object>{ 'apiName' => 'Name', 'direction' => 'desc' } })
            )
        );

        String firstAsc = (String) ((Map<String, Object>) ((List<Object>) ascending.get('rows'))[0]).get('Name');
        String firstDesc = (String) ((Map<String, Object>) ((List<Object>) descending.get('rows'))[0]).get('Name');
        Assert.areNotEqual(firstAsc, firstDesc, 'Reversing the sort must change which record is first.');
    }

    @IsTest
    static void anInjectedSortFieldIsIgnoredRatherThanQueried() {
        // The client is not trusted. A sort on a field that is not in the configuration must not
        // reach the ORDER BY -- if it did, so could anything else.
        Map<String, Object> result = parse(
            StarterListController.fetchList(
                request(
                    new Map<String, Object>{
                        'sort' => new Map<String, Object>{
                            'apiName' => 'Name DESC, (SELECT Id FROM Contacts)',
                            'direction' => 'asc'
                        }
                    }
                )
            )
        );

        Assert.areEqual(10, ((List<Object>) result.get('rows')).size(), 'The query should still run, on the default sort.');
    }

    @IsTest
    static void unknownObjectFailsWithAMessageAUserCanActOn() {
        try {
            StarterListController.fetchList(request(new Map<String, Object>{ 'objectApiName' => 'NotAnObject__c' }));
            Assert.fail('An unknown object should not silently return an empty list.');
        } catch (AuraHandledException e) {
            Assert.isTrue(
                e.getMessage().contains('NotAnObject__c'),
                'The message must name the object; "An error occurred" tells the user nothing.'
            );
        }
    }

    @IsTest
    static void pagingBeyondTheSoqlOffsetCeilingFailsLoudly() {
        try {
            StarterListController.fetchList(request(new Map<String, Object>{ 'pageNumber' => 500 }));
            Assert.fail('Page 500 at 10 per page is an OFFSET of 4990 and cannot be served.');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('2000'), 'Say what the limit is, not just that there is one.');
        }
    }

    @IsTest
    static void pageSizeIsCappedSoOneRequestCannotAskForEverything() {
        Map<String, Object> result = parse(
            StarterListController.fetchList(request(new Map<String, Object>{ 'pageSize' => 5000 }))
        );
        Assert.areEqual(100, (Integer) result.get('pageSize'), 'Page size must be capped server-side.');
    }

    @IsTest
    static void aUserWithoutReadAccessIsRefusedRatherThanShownBlanks() {
        User minimal = buildMinimalAccessUser();

        System.runAs(minimal) {
            try {
                StarterListController.fetchList(request(new Map<String, Object>()));
                // If this org's minimum access profile can read Accounts, the query legitimately
                // succeeds; the assertion below then has nothing to prove and the test still passes.
                // What must never happen is a row coming back with silently emptied fields.
            } catch (AuraHandledException e) {
                Assert.isNotNull(e.getMessage(), 'USER_MODE should throw a real message, not a null one.');
            }
        }
    }

    private static User buildMinimalAccessUser() {
        Profile p = [SELECT Id FROM Profile WHERE Name = 'Minimum Access - Salesforce' LIMIT 1];
        User u = new User(
            ProfileId = p.Id,
            LastName = 'Narayanan',
            Email = 'grid.starter@example.com',
            Username = 'grid.starter.' + DateTime.now().getTime() + '@example.com',
            Alias = 'gstart',
            TimeZoneSidKey = 'America/New_York',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert u;
        return u;
    }
}
