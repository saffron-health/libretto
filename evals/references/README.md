Reference files for eval scenarios.

- Reference workflows should import directly from `"libretto"`.
- Eval fixtures create an isolated workspace package and link `node_modules/libretto` to the local package so copied scripts can run without path placeholders.
