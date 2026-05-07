// lintcn:name no-await-import
// lintcn:description Disallow await import(...) dynamic import syntax.
package no_await_import

import (
	"strings"

	"github.com/microsoft/typescript-go/shim/ast"
	"github.com/microsoft/typescript-go/shim/scanner"
	"github.com/typescript-eslint/tsgolint/internal/rule"
	"github.com/typescript-eslint/tsgolint/internal/utils"
)

const lintcIgnoreDirective = "@lintc-ignore"

func buildAwaitImportMessage() rule.RuleMessage {
	return rule.RuleMessage{
		Id:          "awaitImport",
		Description: "`await import(...)` is not allowed.",
		Help:        "Use a static import, restructure the code to avoid dynamic import, or handle the dynamic import without `await import(...)` syntax. If this is unavoidable and you have human permission, add `// @lintc-ignore <reason>` on the previous line or same line.",
	}
}

func buildMissingIgnoreReasonMessage() rule.RuleMessage {
	return rule.RuleMessage{
		Id:          "missingIgnoreReason",
		Description: "`// @lintc-ignore` must include a reason.",
		Help:        "Only use this ignore comment with human permission. Explain why this `await import(...)` is unavoidable, for example: `// @lintc-ignore user workflows must load dynamic files`.",
	}
}

var NoAwaitImportRule = rule.Rule{
	Name: "no-await-import",
	Run: func(ctx rule.RuleContext, options any) rule.RuleListeners {
		return rule.RuleListeners{
			ast.KindAwaitExpression: func(node *ast.Node) {
				expression := ast.SkipParentheses(node.AsAwaitExpression().Expression)
				if ast.IsImportCall(expression) {
					ignored, hasReason := hasLintcIgnore(ctx, node)
					if ignored && hasReason {
						return
					}
					if ignored {
						ctx.ReportNode(node, buildMissingIgnoreReasonMessage())
						return
					}
					ctx.ReportNode(node, buildAwaitImportMessage())
				}
			},
		}
	},
}

func hasLintcIgnore(ctx rule.RuleContext, node *ast.Node) (ignored bool, hasReason bool) {
	r := utils.TrimNodeTextRange(ctx.SourceFile, node)
	lineStarts := scanner.GetECMALineStarts(ctx.SourceFile)
	line := scanner.ComputeLineOfPosition(lineStarts, r.Pos())

	if ignored, hasReason := hasLintcIgnoreInLine(ctx.SourceFile, line, r.Pos()); ignored {
		return ignored, hasReason
	}
	if line == 0 {
		return false, false
	}
	return hasLintcIgnoreInLine(ctx.SourceFile, line-1, -1)
}

func hasLintcIgnoreInLine(sourceFile *ast.SourceFile, line int, awaitPos int) (ignored bool, hasReason bool) {
	text := sourceFile.Text()
	lineStarts := scanner.GetECMALineStarts(sourceFile)
	start := int(lineStarts[line])
	end := len(text)
	if line+1 < len(lineStarts) {
		end = int(lineStarts[line+1])
	}
	if awaitPos >= 0 {
		start = awaitPos
	}
	return parseLintcIgnore(text[start:end])
}

func parseLintcIgnore(text string) (ignored bool, hasReason bool) {
	commentStart := strings.Index(text, "//")
	if commentStart < 0 {
		return false, false
	}
	comment := strings.TrimSpace(text[commentStart+len("//"):])
	if comment == lintcIgnoreDirective {
		return true, false
	}
	if !strings.HasPrefix(comment, lintcIgnoreDirective+" ") && !strings.HasPrefix(comment, lintcIgnoreDirective+"\t") {
		return false, false
	}
	remainder := strings.TrimSpace(strings.TrimPrefix(comment, lintcIgnoreDirective))
	return true, remainder != ""
}
