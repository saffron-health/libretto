import Prism from "prismjs";

const prismGlobal = globalThis as typeof globalThis & { Prism?: typeof Prism };
prismGlobal.Prism = Prism;

export { Prism };
