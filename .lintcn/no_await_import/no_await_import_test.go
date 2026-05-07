package no_await_import

import (
	"testing"

	"github.com/typescript-eslint/tsgolint/internal/rule_tester"
	"github.com/typescript-eslint/tsgolint/internal/rules/fixtures"
)

func TestNoAwaitImport(t *testing.T) {
	t.Parallel()
	rule_tester.RunRuleTester(fixtures.GetRootDir(), "tsconfig.minimal.json", t, &NoAwaitImportRule, []rule_tester.ValidTestCase{
		{Code: `import value from "module";`},
		{Code: `const modulePromise = import("module");`},
		{Code: `import("module").then((mod) => mod.default);`},
		{Code: `async function run(value: Promise<number>) { return await value; }`},
		{Code: `
async function run() {
  // @lintc-ignore user workflow files are selected at runtime
  return await import("module");
}
`},
		{Code: `
async function run() {
  return await import("module"); // @lintc-ignore user workflow files are selected at runtime
}
`},
	}, []rule_tester.InvalidTestCase{
		{
			Code: `async function run() { return await import("module"); }`,
			Errors: []rule_tester.InvalidTestCaseError{
				{MessageId: "awaitImport"},
			},
		},
		{
			Code: `async function run() { return await (import("module")); }`,
			Errors: []rule_tester.InvalidTestCaseError{
				{MessageId: "awaitImport"},
			},
		},
		{
			Code: `
async function run() {
  // @lintc-ignore
  return await import("module");
}
`,
			Errors: []rule_tester.InvalidTestCaseError{
				{MessageId: "missingIgnoreReason"},
			},
		},
		{
			Code: `
async function run() {
  return await import("module"); // @lintc-ignore
}
`,
			Errors: []rule_tester.InvalidTestCaseError{
				{MessageId: "missingIgnoreReason"},
			},
		},
	})
}
