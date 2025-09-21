/**
 * vBookmarks Integration Test
 *
 * Tests the integration between new modular system and existing neat.js
 */

class IntegrationTest {
    constructor() {
        this.testResults = [];
    }

    /**
     * Wait for modules to be loaded
     */
    async waitForModules() {
        const maxAttempts = 100; // 10 seconds max wait
        let attempts = 0;

        while (attempts < maxAttempts) {
            if (window.DOMUtils && window.vBookmarks && window.moduleLoader) {
                console.log('✅ All modules are available');
                return;
            }

            attempts++;
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.warn('⚠️ Some modules not available after timeout');
    }

    /**
     * Run all integration tests
     */
    async runTests() {
        console.log('🧪 Running integration tests...');

        // Wait for modules to be loaded
        await this.waitForModules();

        this.testResults = [];

        // Test 1: Check if all modules are loaded
        this.testModuleLoading();

        // Test 2: Check if vBookmarks global is available
        this.testGlobalObject();

        // Test 3: Check if compatibility helpers are available
        this.testCompatibilityHelpers();

        // Test 4: Test bookmark operations through helpers
        await this.testBookmarkOperations();

        // Test 5: Test UI operations through helpers
        this.testUIOperations();

        // Test 6: Test search functionality
        await this.testSearchFunctionality();

        this.displayResults();
    }

    /**
     * Test if all modules are loaded correctly
     */
    testModuleLoading() {
        const test = {
            name: 'Module Loading',
            passed: false,
            details: []
        };

        const expectedModules = ['bookmarkManager', 'uiManager', 'domUtils'];
        const actualModules = Array.from(window.moduleLoader?.modules?.keys() || []);

        expectedModules.forEach(module => {
            const loaded = window.moduleLoader?.hasModule(module);
            test.details.push(`${module}: ${loaded ? '✅' : '❌'}`);
            if (!loaded) {
                test.passed = false;
            }
        });

        // Check if search manager is available (optional)
        const searchLoaded = window.moduleLoader?.hasModule('searchManager');
        if (searchLoaded) {
            test.details.push('searchManager: ✅');
        }

        test.passed = expectedModules.every(module =>
            window.moduleLoader?.hasModule(module)
        );

        this.testResults.push(test);
    }

    /**
     * Test if vBookmarks global object is available
     */
    testGlobalObject() {
        const test = {
            name: 'Global Object Availability',
            passed: false,
            details: []
        };

        const hasVBookmarks = typeof window.vBookmarks !== 'undefined';
        test.details.push(`window.vBookmarks: ${hasVBookmarks ? '✅' : '❌'}`);

        if (hasVBookmarks && window.vBookmarks) {
            const modules = ['bookmarkManager', 'uiManager', 'domUtils'];
            modules.forEach(module => {
                const available = typeof window.vBookmarks[module] !== 'undefined';
                test.details.push(`vBookmarks.${module}: ${available ? '✅' : '❌'}`);
            });
        }

        test.passed = hasVBookmarks &&
                      typeof window.vBookmarks.bookmarkManager !== 'undefined' &&
                      typeof window.vBookmarks.uiManager !== 'undefined' &&
                      typeof window.vBookmarks.domUtils !== 'undefined';

        this.testResults.push(test);
    }

    /**
     * Test if compatibility helpers are available
     */
    testCompatibilityHelpers() {
        const test = {
            name: 'Compatibility Helpers',
            passed: false,
            details: []
        };

        const helpers = window.vBookmarksHelpers;
        const hasHelpers = typeof helpers !== 'undefined';

        test.details.push(`vBookmarksHelpers: ${hasHelpers ? '✅' : '❌'}`);

        if (hasHelpers && helpers) {
            const expectedHelpers = [
                'createBookmark', 'createFolder', 'updateBookmark', 'deleteBookmark',
                'searchBookmarks', 'renderTree', 'showSearchResults', 'clearSearch',
                '$', '$$', 'on', 'debounce', 'throttle'
            ];

            expectedHelpers.forEach(helper => {
                const available = typeof helpers[helper] === 'function';
                test.details.push(`${helper}: ${available ? '✅' : '❌'}`);
            });
        }

        test.passed = hasHelpers &&
                      typeof window.createBookmark === 'function' &&
                      typeof window.createFolder === 'function' &&
                      typeof window.searchBookmarks === 'function';

        this.testResults.push(test);
    }

    /**
     * Test bookmark operations through helpers
     */
    async testBookmarkOperations() {
        const test = {
            name: 'Bookmark Operations',
            passed: false,
            details: []
        };

        try {
            // Test bookmark manager methods exist
            const bookmarkManager = window.vBookmarks?.bookmarkManager;
            if (bookmarkManager) {
                const methods = ['createBookmark', 'updateBookmark', 'deleteBookmark', 'searchBookmarks'];
                methods.forEach(method => {
                    const available = typeof bookmarkManager[method] === 'function';
                    test.details.push(`BookmarkManager.${method}: ${available ? '✅' : '❌'}`);
                });

                // Test search (should not fail)
                try {
                    const searchResults = await bookmarkManager.searchBookmarks('test');
                    test.details.push(`searchBookmarks() works: ✅`);
                } catch (error) {
                    test.details.push(`searchBookmarks() failed: ❌ (${error.message})`);
                }
            } else {
                test.details.push('BookmarkManager not available: ❌');
            }

            test.passed = test.details.every(detail => detail.includes('✅'));
        } catch (error) {
            test.details.push(`Error: ${error.message}`);
            test.passed = false;
        }

        this.testResults.push(test);
    }

    /**
     * Test UI operations through helpers
     */
    testUIOperations() {
        const test = {
            name: 'UI Operations',
            passed: false,
            details: []
        };

        const uiManager = window.vBookmarks?.uiManager;
        if (uiManager) {
            const methods = ['renderBookmarkTree', 'renderSearchResults', 'showTreeView'];
            methods.forEach(method => {
                const available = typeof uiManager[method] === 'function';
                test.details.push(`UIManager.${method}: ${available ? '✅' : '❌'}`);
            });

            // Test DOM utils
            const domUtils = window.vBookmarks?.domUtils;
            if (domUtils) {
                const domMethods = ['$', '$$', 'on', 'debounce'];
                domMethods.forEach(method => {
                    const available = typeof domUtils[method] === 'function';
                    test.details.push(`DOMUtils.${method}: ${available ? '✅' : '❌'}`);
                });
            } else {
                test.details.push('DOMUtils not available: ❌');
            }
        } else {
            test.details.push('UIManager not available: ❌');
        }

        test.passed = test.details.every(detail => detail.includes('✅'));
        this.testResults.push(test);
    }

    /**
     * Test search functionality
     */
    async testSearchFunctionality() {
        const test = {
            name: 'Search Functionality',
            passed: false,
            details: []
        };

        const searchManager = window.vBookmarks?.searchManager;
        if (searchManager) {
            try {
                // Test search
                await searchManager.search('test');
                test.details.push('SearchManager.search(): ✅');

                // Test clear search
                searchManager.clearSearch();
                test.details.push('SearchManager.clearSearch(): ✅');

                // Test get search state
                const state = searchManager.getSearchState();
                test.details.push('SearchManager.getSearchState(): ✅');
            } catch (error) {
                test.details.push(`Search operations failed: ❌ (${error.message})`);
            }
        } else {
            test.details.push('SearchManager not available: ❌');
        }

        test.passed = test.details.every(detail => detail.includes('✅'));
        this.testResults.push(test);
    }

    /**
     * Display test results
     */
    displayResults() {
        console.log('\n📊 Integration Test Results:');
        console.log('='.repeat(50));

        const passedTests = this.testResults.filter(test => test.passed).length;
        const totalTests = this.testResults.length;

        this.testResults.forEach(test => {
            const status = test.passed ? '✅' : '❌';
            console.log(`${status} ${test.name}`);

            if (test.details.length > 0) {
                test.details.forEach(detail => {
                    console.log(`  ${detail}`);
                });
            }
        });

        console.log('='.repeat(50));
        console.log(`🎯 Summary: ${passedTests}/${totalTests} tests passed`);

        if (passedTests === totalTests) {
            console.log('🎉 All integration tests passed!');
        } else {
            console.log('⚠️  Some integration tests failed. Check the details above.');
        }

        // Store results globally for debugging
        window.integrationTestResults = this.testResults;
    }
}

// Auto-run tests is now handled by legacy-bridge.js

// Export for testing
export { IntegrationTest };

// Also attach to window for legacy compatibility
if (typeof window !== 'undefined') {
    window.IntegrationTest = IntegrationTest;
}