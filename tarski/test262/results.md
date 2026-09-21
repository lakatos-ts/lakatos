# test262 results

The evaluator run against test262 at `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, over `test/language`, `test/built-ins`, `test/intl402`, with a 10-second per-test timeout. Written by `sh scripts/test262-full.sh`; not edited by hand.

## By directory

| directory                                     | tests |  pass |  fail | unsupported | timeout | harness-error | not-run |
| --------------------------------------------- | ----: | ----: | ----: | ----------: | ------: | ------------: | ------: |
| test/built-ins/AbstractModuleSource           |     8 |     0 |     0 |           0 |       0 |             0 |       8 |
| test/built-ins/AggregateError                 |    25 |    20 |     3 |           2 |       0 |             0 |       0 |
| test/built-ins/Array                          |  3082 |  2579 |   271 |         108 |       0 |             0 |     124 |
| test/built-ins/ArrayBuffer                    |   221 |     0 |   201 |          20 |       0 |             0 |       0 |
| test/built-ins/ArrayIteratorPrototype         |    27 |     9 |     9 |           1 |       0 |             0 |       8 |
| test/built-ins/AsyncDisposableStack           |   104 |     0 |    68 |           7 |       0 |             0 |      29 |
| test/built-ins/AsyncFromSyncIteratorPrototype |    38 |     0 |     0 |           1 |       0 |             0 |      37 |
| test/built-ins/AsyncFunction                  |    18 |     1 |     0 |          17 |       0 |             0 |       0 |
| test/built-ins/AsyncGeneratorFunction         |    23 |     0 |     0 |          17 |       0 |             0 |       6 |
| test/built-ins/AsyncGeneratorPrototype        |    48 |     0 |     0 |          13 |       0 |             0 |      35 |
| test/built-ins/AsyncIteratorPrototype         |    13 |     0 |     0 |           9 |       0 |             0 |       4 |
| test/built-ins/Atomics                        |   389 |     0 |   187 |         137 |       0 |             0 |      65 |
| test/built-ins/BigInt                         |    77 |     0 |    34 |          43 |       0 |             0 |       0 |
| test/built-ins/Boolean                        |    51 |    43 |     5 |           3 |       0 |             0 |       0 |
| test/built-ins/DataView                       |   561 |     0 |   453 |         108 |       0 |             0 |       0 |
| test/built-ins/Date                           |   594 |     0 |   585 |           9 |       0 |             0 |       0 |
| test/built-ins/DisposableStack                |    93 |     0 |    91 |           2 |       0 |             0 |       0 |
| test/built-ins/Error                          |    93 |    50 |    35 |           8 |       0 |             0 |       0 |
| test/built-ins/FinalizationRegistry           |    47 |     0 |    46 |           1 |       0 |             0 |       0 |
| test/built-ins/Function                       |   509 |   159 |    50 |         212 |       0 |             0 |      88 |
| test/built-ins/GeneratorFunction              |    23 |     0 |     0 |          23 |       0 |             0 |       0 |
| test/built-ins/GeneratorPrototype             |    61 |     0 |     0 |          61 |       0 |             0 |       0 |
| test/built-ins/Infinity                       |     6 |     1 |     3 |           0 |       0 |             0 |       2 |
| test/built-ins/Iterator                       |   654 |     4 |   441 |         209 |       0 |             0 |       0 |
| test/built-ins/JSON                           |   165 |   116 |    40 |           9 |       0 |             0 |       0 |
| test/built-ins/Map                            |   204 |     0 |   198 |           5 |       0 |             0 |       1 |
| test/built-ins/MapIteratorPrototype           |    11 |     0 |    11 |           0 |       0 |             0 |       0 |
| test/built-ins/Math                           |   327 |   143 |   182 |           2 |       0 |             0 |       0 |
| test/built-ins/NaN                            |     6 |     2 |     2 |           0 |       0 |             0 |       2 |
| test/built-ins/NativeErrors                   |    94 |    76 |    12 |           6 |       0 |             0 |       0 |
| test/built-ins/Number                         |   340 |   325 |    10 |           5 |       0 |             0 |       0 |
| test/built-ins/Object                         |  3411 |  2955 |   394 |          51 |       0 |             0 |      11 |
| test/built-ins/Promise                        |   732 |     0 |   307 |           9 |       0 |             0 |     416 |
| test/built-ins/Proxy                          |   311 |     0 |   254 |          45 |       0 |             0 |      12 |
| test/built-ins/Reflect                        |   153 |     0 |   152 |           1 |       0 |             0 |       0 |
| test/built-ins/RegExp                         |  1687 |     0 |   445 |        1241 |       0 |             0 |       1 |
| test/built-ins/RegExpStringIteratorPrototype  |    17 |     0 |     0 |          17 |       0 |             0 |       0 |
| test/built-ins/Set                            |   383 |     0 |   323 |          59 |       0 |             0 |       1 |
| test/built-ins/SetIteratorPrototype           |    11 |     0 |    11 |           0 |       0 |             0 |       0 |
| test/built-ins/ShadowRealm                    |    64 |     0 |    57 |           3 |       0 |             0 |       4 |
| test/built-ins/SharedArrayBuffer              |   104 |     0 |   101 |           3 |       0 |             0 |       0 |
| test/built-ins/String                         |  1223 |   940 |   132 |         148 |       0 |             0 |       3 |
| test/built-ins/StringIteratorPrototype        |     7 |     7 |     0 |           0 |       0 |             0 |       0 |
| test/built-ins/SuppressedError                |    22 |     0 |    20 |           2 |       0 |             0 |       0 |
| test/built-ins/Symbol                         |    98 |    68 |     9 |          19 |       0 |             0 |       2 |
| test/built-ins/Temporal                       |  4605 |     0 |  2280 |        2325 |       0 |             0 |       0 |
| test/built-ins/ThrowTypeError                 |    14 |    10 |     3 |           1 |       0 |             0 |       0 |
| test/built-ins/TypedArray                     |  1446 |     0 |   932 |         506 |       0 |             0 |       8 |
| test/built-ins/TypedArrayConstructors         |   738 |     0 |   549 |         173 |       0 |             0 |      16 |
| test/built-ins/Uint8Array                     |    70 |     0 |    66 |           4 |       0 |             0 |       0 |
| test/built-ins/WeakMap                        |   141 |     0 |   139 |           2 |       0 |             0 |       0 |
| test/built-ins/WeakRef                        |    29 |     0 |    28 |           1 |       0 |             0 |       0 |
| test/built-ins/WeakSet                        |    85 |     0 |    84 |           1 |       0 |             0 |       0 |
| test/built-ins/decodeURI                      |    55 |     0 |    27 |          28 |       0 |             0 |       0 |
| test/built-ins/decodeURIComponent             |    56 |     0 |    28 |          28 |       0 |             0 |       0 |
| test/built-ins/encodeURI                      |    31 |     0 |    20 |          11 |       0 |             0 |       0 |
| test/built-ins/encodeURIComponent             |    31 |     0 |    20 |          11 |       0 |             0 |       0 |
| test/built-ins/eval                           |    10 |     0 |    10 |           0 |       0 |             0 |       0 |
| test/built-ins/global                         |    29 |    14 |    14 |           1 |       0 |             0 |       0 |
| test/built-ins/isFinite                       |    15 |     0 |    15 |           0 |       0 |             0 |       0 |
| test/built-ins/isNaN                          |    15 |     0 |    15 |           0 |       0 |             0 |       0 |
| test/built-ins/parseFloat                     |    54 |    51 |     2 |           1 |       0 |             0 |       0 |
| test/built-ins/parseInt                       |    55 |    52 |     2 |           1 |       0 |             0 |       0 |
| test/built-ins/undefined                      |     8 |     1 |     4 |           0 |       0 |             0 |       3 |
| test/language/arguments-object                |   262 |    68 |     2 |          75 |       0 |             0 |     117 |
| test/language/asi                             |    67 |    65 |     0 |           2 |       0 |             0 |       0 |
| test/language/block-scope                     |    43 |    43 |     0 |           0 |       0 |             0 |       0 |
| test/language/comments                        |    27 |    12 |     6 |           3 |       0 |             0 |       6 |
| test/language/computed-property-names         |    48 |    16 |     0 |          32 |       0 |             0 |       0 |
| test/language/destructuring                   |    19 |    15 |     0 |           3 |       0 |             0 |       1 |
| test/language/directive-prologue              |    51 |     0 |     0 |           0 |       0 |             0 |      51 |
| test/language/eval-code                       |   347 |     5 |    64 |          54 |       0 |             0 |     224 |
| test/language/expressions                     |  9068 |  2541 |   311 |        3552 |       0 |             3 |    2661 |
| test/language/function-code                   |   217 |    93 |     6 |           9 |       0 |             0 |     109 |
| test/language/future-reserved-words           |    29 |    22 |     0 |           0 |       0 |             0 |       7 |
| test/language/global-code                     |    28 |     5 |     6 |          12 |       0 |             0 |       5 |
| test/language/identifier-resolution           |    13 |     4 |     4 |           0 |       0 |             0 |       5 |
| test/language/identifiers                     |   152 |   136 |     0 |           0 |       0 |            16 |       0 |
| test/language/import                          |   116 |     0 |     0 |           0 |       0 |             0 |     116 |
| test/language/line-terminators                |    24 |    15 |     7 |           2 |       0 |             0 |       0 |
| test/language/literals                        |   215 |   134 |    29 |          47 |       0 |             0 |       5 |
| test/language/module-code                     |   402 |     1 |     0 |           0 |       0 |             0 |     401 |
| test/language/punctuators                     |     1 |     0 |     0 |           1 |       0 |             0 |       0 |
| test/language/reserved-words                  |    14 |    14 |     0 |           0 |       0 |             0 |       0 |
| test/language/rest-parameters                 |    10 |    10 |     0 |           0 |       0 |             0 |       0 |
| test/language/source-text                     |     1 |     1 |     0 |           0 |       0 |             0 |       0 |
| test/language/statementList                   |    80 |    28 |    40 |          12 |       0 |             0 |       0 |
| test/language/statements                      |  7841 |  2271 |   298 |        2389 |       0 |             3 |    2880 |
| test/language/types                           |   102 |    74 |     8 |          11 |       0 |             0 |       9 |
| test/language/white-space                     |    61 |    20 |    16 |          25 |       0 |             0 |       0 |
| total                                         | 42860 | 13219 | 10177 |       11959 |       0 |            22 |    7483 |

## Not run and skipped

| kind                | tests | where             |
| ------------------- | ----: | ----------------- |
| noStrict            |  1624 | not-run column    |
| raw                 |     5 | not-run column    |
| async               |  5256 | not-run column    |
| module              |   598 | not-run column    |
| budget              |     0 | not-run column    |
| parse-negative      |  4646 | outside the table |
| resolution-negative |    34 | outside the table |
| intl402             |  3357 | outside the table |

## Unsupported

| kind                              | tests |
| --------------------------------- | ----: |
| RegularExpressionLiteral          |  3032 |
| BigIntLiteral                     |  1493 |
| MethodDefinition generator        |  1444 |
| MethodDefinition private          |   936 |
| FunctionExpression generator      |   917 |
| FunctionDeclaration generator     |   743 |
| Function constructor              |   384 |
| ComputedPropertyName              |   371 |
| BinaryExpression ,                |   344 |
| $262.detachArrayBuffer            |   300 |
| MethodDefinition async            |   217 |
| Property generator                |   201 |
| $262.createRealm                  |   163 |
| FunctionExpression async          |   137 |
| FunctionDeclaration async         |   123 |
| AssignmentExpression >>>=         |   109 |
| BinaryExpression ==               |    90 |
| MetaProperty                      |    74 |
| BinaryExpression !=               |    72 |
| ImportKeyword                     |    72 |
| $262.agent                        |    59 |
| Property async                    |    52 |
| BinaryExpression <<               |    46 |
| BinaryExpression >>>              |    44 |
| BinaryExpression &                |    38 |
| BinaryExpression >>               |    37 |
| ClassStaticBlockDeclaration       |    37 |
| AssignmentExpression |=           |    29 |
| BinaryExpression |                |    29 |
| MethodDefinition numeric key      |    29 |
| AssignmentExpression &=           |    28 |
| AssignmentExpression <<=          |    28 |
| AssignmentExpression >>=          |    28 |
| AssignmentExpression ^=           |    28 |
| BinaryExpression ^                |    28 |
| ArrowFunctionExpression async     |    27 |
| LogicalExpression ??              |    22 |
| AssignmentExpression &&=          |    17 |
| AssignmentExpression ??=          |    17 |
| AssignmentExpression super target |    17 |
| AssignmentExpression ||=          |    17 |
| UnaryExpression ~                 |    17 |
| $262.evalScript                   |    12 |
| Decorator                         |    12 |
| PropertyAccessExpression          |    11 |
| PrivateIdentifier                 |     5 |
| CallExpression                    |     4 |
| ElementAccessExpression           |     4 |
| PropertyDefinition numeric key    |     4 |
| UnaryExpression delete super      |     4 |
| AccessorKeyword                   |     2 |
| AssignmentExpression **=          |     2 |
| AssignmentExpression target       |     1 |
| DebuggerStatement                 |     1 |
| WithStatement                     |     1 |
