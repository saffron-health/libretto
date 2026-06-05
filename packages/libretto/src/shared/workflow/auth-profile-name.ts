export function normalizeProfileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Profile name is required.");
  }
  if (!isValidProfileName(trimmed)) {
    throw new Error(
      `Invalid profile name "${name}". Use letters, numbers, dots, underscores, and dashes only.`,
    );
  }
  return trimmed;
}

function isValidProfileName(name: string): boolean {
  if (name === "." || name === "..") return false;
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    const isUppercase = code >= 65 && code <= 90;
    const isLowercase = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    const isAllowedPunctuation = code === 45 || code === 46 || code === 95;
    if (!isUppercase && !isLowercase && !isDigit && !isAllowedPunctuation) {
      return false;
    }
  }
  return true;
}
