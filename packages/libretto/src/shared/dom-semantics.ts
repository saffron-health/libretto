export const TEST_ATTRIBUTE_NAMES = [
  "data-testid",
  "data-test",
  "data-qa",
  "data-cy",
] as const;

export const TRUSTED_ATTRIBUTE_NAMES = [
  "id",
  "name",
  "for",
  "tabindex",
  "contenteditable",
  "role",
  "title",
  "alt",
  "type",
  "value",
  "placeholder",
  "autocomplete",
  "href",
  "action",
  "method",
  "src",
] as const;

export const INTERACTIVE_TAG_NAMES = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "form",
  "details",
  "dialog",
  "label",
] as const;

export const INTERACTIVE_ROLE_NAMES = [
  "button",
  "link",
  "tab",
  "menuitem",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "combobox",
] as const;

export function filterSemanticClasses(value: string): string {
  const classes = value.split(/\s+/).filter(Boolean);
  const kept = classes.filter((cls) => !isObfuscatedClass(cls));
  return kept.join(" ");
}

export function isObfuscatedClass(cls: string): boolean {
  if (cls.length > 80) return true;
  if (/^_?[0-9a-f]{6,}$/i.test(cls)) return true;
  if (/^[a-z]+_[0-9a-f]{4,}$/i.test(cls)) return true;
  if (/^[a-z]{1,2}[0-9]{2,}$/i.test(cls)) return true;

  const digits = (cls.match(/[0-9]/g) || []).length;
  const letters = (cls.match(/[a-zA-Z]/g) || []).length;
  if (cls.length >= 6 && digits >= letters * 0.5 && digits >= 2) return true;

  return false;
}
