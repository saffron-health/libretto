// Local oxlint JS plugin (alpha JS-plugin API) providing the two custom rules
// that oxlint has no native equivalent for. The type-aware rules
// (no-floating-promises, await-thenable) are configured natively in
// .oxlintrc.json and run via tsgolint.

const noAwaitImport = {
  meta: {
    messages: {
      awaitImport:
        "`await import(...)` is not allowed. Use a static import, or suppress with `// oxlint-disable-next-line libretto/no-await-import -- <reason>`.",
    },
  },
  create(context) {
    return {
      "AwaitExpression > ImportExpression"(node) {
        context.report({ node, messageId: "awaitImport" });
      },
    };
  },
};

const requireDisableDescription = {
  meta: {
    messages: {
      missingDescription:
        "Disable directive must include a description explaining why the suppression is necessary (e.g. `-- Human-approved: ...`).",
    },
  },
  create(context) {
    return {
      Program(program) {
        const { directives } = context.sourceCode.getDisableDirectives();
        for (const directive of directives) {
          if (!directive.justification) {
            context.report({
              node: directive.node ?? program,
              messageId: "missingDescription",
            });
          }
        }
      },
    };
  },
};

const plugin = {
  meta: {
    name: "libretto",
  },
  rules: {
    "no-await-import": noAwaitImport,
    "require-disable-description": requireDisableDescription,
  },
};

export default plugin;
