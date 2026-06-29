import {
  any,
  end,
  lookahead,
  maybe,
  not,
  oneOf,
  oneOrMore,
  sequence,
  text,
  whitespace,
  zeroOrMore,
} from "teg-parser";

export type CommandLineInputToken =
  | { type: "argument"; value: string }
  | { type: "option"; key: string; value?: string };

const whitespaceCharParser = oneOf([text("\n"), text(" "), text("\t"), text("\r")]);
const quoteCharParser = oneOf([text('"'), text("'")]);
const escapedCharParser = sequence([text("\\"), any]).map(([, char]) => char);

const bareTokenPartParser = oneOrMore(not(oneOf([whitespaceCharParser, quoteCharParser]))).map(
  (chars) => chars.join(""),
);
const doubleQuotedTokenPartParser = sequence([
  text('"'),
  zeroOrMore(oneOf([escapedCharParser, not(text('"'))])),
  text('"'),
]).map(([, chars]) => chars.join(""));
const singleQuotedTokenPartParser = sequence([
  text("'"),
  zeroOrMore(oneOf([escapedCharParser, not(text("'"))])),
  text("'"),
]).map(([, chars]) => chars.join(""));
const valueParser = oneOrMore(
  oneOf([bareTokenPartParser, doubleQuotedTokenPartParser, singleQuotedTokenPartParser]),
).map((parts) => parts.join(""));

const optionKeyParser = oneOrMore(not(oneOf([text("="), whitespaceCharParser]))).map((chars) =>
  chars.join(""),
);
const inlineOptionValueParser = sequence([text("="), valueParser]).map(([, value]) => value);
const separatedOptionValueParser = sequence([
  oneOrMore(whitespaceCharParser),
  lookahead(not(text("-"))),
  valueParser,
]).map(([, , value]) => value);
const longOptionParser = sequence([
  text("--"),
  optionKeyParser,
  maybe(oneOf([inlineOptionValueParser, separatedOptionValueParser])),
]).map(([, key, value]): CommandLineInputToken => ({ type: "option", key, value }));
const shortOptionParser = sequence([
  text("-"),
  optionKeyParser,
  maybe(oneOf([inlineOptionValueParser, separatedOptionValueParser])),
]).map(([, key, value]): CommandLineInputToken => ({ type: "option", key, value }));
const optionParser = oneOf([longOptionParser, shortOptionParser]);
const argumentParser = valueParser.map(
  (value): CommandLineInputToken => ({ type: "argument", value }),
);

const inputParser = sequence([
  whitespace,
  zeroOrMore(sequence([oneOf([optionParser, argumentParser]), whitespace]).map(([token]) => token)),
  end,
]).map(([, tokens]) => tokens);

export function parseCommandLine(commandLine: string): CommandLineInputToken[] {
  const result = inputParser.run(commandLine);
  if (result.isFailure()) {
    throw new Error(result.value);
  }

  return result.value;
}
