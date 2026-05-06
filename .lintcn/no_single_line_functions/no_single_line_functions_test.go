package no_single_line_functions

import (
	"testing"

	"github.com/typescript-eslint/tsgolint/internal/rule_tester"
	"github.com/typescript-eslint/tsgolint/internal/rules/fixtures"
)

func TestNoSingleLineFunctions(t *testing.T) {
	t.Parallel()
	rule_tester.RunRuleTester(fixtures.GetRootDir(), "tsconfig.minimal.json", t, &NoSingleLineFunctionsRule, []rule_tester.ValidTestCase{
		{Code: `
function keepHelper() {
  return 1;
}
`},
		{Code: `
const keepHelper = () => {
  return 1;
};
`},
		{Code: `
values.map((value) => value + 1);
values.forEach(function (value) { console.log(value); });
`},
	}, []rule_tester.InvalidTestCase{
		{
			Code: `function helper() { return 1; }`,
			Errors: []rule_tester.InvalidTestCaseError{
				{MessageId: "singleLineFunction"},
			},
		},
		{
			Code: `const helper = function () { return 1; };`,
			Errors: []rule_tester.InvalidTestCaseError{
				{MessageId: "singleLineFunction"},
			},
		},
		{
			Code: `const helper = () => value + 1;`,
			Errors: []rule_tester.InvalidTestCaseError{
				{MessageId: "singleLineFunction"},
			},
		},
	})
}
