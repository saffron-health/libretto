// lintcn:name no-single-line-functions
// lintcn:description Disallow one-line helper functions; inline them instead.
package no_single_line_functions

import (
	"github.com/microsoft/typescript-go/shim/ast"
	"github.com/microsoft/typescript-go/shim/scanner"
	"github.com/typescript-eslint/tsgolint/internal/rule"
	"github.com/typescript-eslint/tsgolint/internal/utils"
)

func buildSingleLineFunctionMessage() rule.RuleMessage {
	return rule.RuleMessage{
		Id:          "singleLineFunction",
		Description: "No single-line functions — just inline it instead.",
		Help:        "Inline this helper at its call site, or expand it into a multi-line function if it carries enough behavior to keep.",
	}
}

func isSingleLineNode(ctx rule.RuleContext, node *ast.Node) bool {
	r := utils.TrimNodeTextRange(ctx.SourceFile, node)
	return scanner.GetECMALineOfPosition(ctx.SourceFile, r.Pos()) == scanner.GetECMALineOfPosition(ctx.SourceFile, r.End())
}

func isVariableInitializer(node *ast.Node) bool {
	parent := node.Parent
	return parent != nil && ast.IsVariableDeclaration(parent) && parent.Initializer() == node
}

func reportIfSingleLine(ctx rule.RuleContext, node *ast.Node) {
	if isSingleLineNode(ctx, node) {
		ctx.ReportNode(node, buildSingleLineFunctionMessage())
	}
}

var NoSingleLineFunctionsRule = rule.Rule{
	Name: "no-single-line-functions",
	Run: func(ctx rule.RuleContext, options any) rule.RuleListeners {
		return rule.RuleListeners{
			ast.KindFunctionDeclaration: func(node *ast.Node) {
				if node.Body() != nil {
					reportIfSingleLine(ctx, node)
				}
			},
			ast.KindFunctionExpression: func(node *ast.Node) {
				if isVariableInitializer(node) {
					reportIfSingleLine(ctx, node)
				}
			},
			ast.KindArrowFunction: func(node *ast.Node) {
				if isVariableInitializer(node) {
					reportIfSingleLine(ctx, node)
				}
			},
		}
	},
}
