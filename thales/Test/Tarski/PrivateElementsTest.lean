import Tarski.Eval
import Tarski.Format

/-! Private methods and accessors: elements the instance carries beside
its fields, installed ahead of them, shared across instances, invisible
to every property walk, and read and written through the class's own
scope. -/

open Tarski

private def outcome (p : Program) : String :=
  match runScript p with
  | none => "<diverges>"
  | some (.error (.throw v), h) => s!"uncaught: {describeThrown h v}"
  | some (.error _, _) => "<abrupt>"
  | some (.ok none, _) => "<empty>"
  | some (.ok (some v), _) => formatValue v

private def cls (name : String) (elements : List ClassElement) : Stmt :=
  .classDecl name { name := some name, superClass := none, elements }

private def letConst (name : String) (e : Expr) : Stmt :=
  .varDecl .«const» [{ target := name, init := some e }]

/-- ```js
class A {
  #v = 1;
  #m() { return this.#v + 1; }
  get #g() { return this.#v * 10; }
  set #g(x) { this.#v = x; }
  call() { return this.#m(); }
  read() { return this.#g; }
  write(x) { this.#g = x; return this; }
  fn() { return this.#m; }
  setM() { this.#m = 0; }
}
``` -/
private def aClass : Stmt :=
  cls "A"
    [ .field false (.«private» "v") (some (.numLit 1.0)),
      .method .method false (.«private» "m") []
        [.returnStmt (some (.binary .add (.privateMember .this "v") (.numLit 1.0)))],
      .method .getter false (.«private» "g") []
        [.returnStmt (some (.binary .mul (.privateMember .this "v") (.numLit 10.0)))],
      .method .setter false (.«private» "g") ["x"]
        [.exprStmt (.assign (.privateMember .this "v") (.ident "x"))],
      .method .method false "call" []
        [.returnStmt (some (.call (.privateMember .this "m") []))],
      .method .method false "read" []
        [.returnStmt (some (.privateMember .this "g"))],
      .method .method false "write" ["x"]
        [ .exprStmt (.assign (.privateMember .this "g") (.ident "x")),
          .returnStmt (some .this) ],
      .method .method false "fn" []
        [.returnStmt (some (.privateMember .this "m"))],
      .method .method false "setM" []
        [.exprStmt (.assign (.privateMember .this "m") (.numLit 0.0))] ]

-- `new A().call()` is 2: the method reads the field through `this`.
#guard outcome [aClass, .exprStmt (.call (.member (.new (.ident "A") []) "call") [])] == "2"

-- The getter runs on the instance: `new A().read()` is 10.
#guard outcome [aClass, .exprStmt (.call (.member (.new (.ident "A") []) "read") [])] == "10"

-- The setter writes the field: `new A().write(5).read()` is 50.
#guard outcome
    [ aClass,
      .exprStmt (.call (.member (.call (.member (.new (.ident "A") []) "write") [.numLit 5.0]) "read") []) ]
  == "50"

-- One function object per method, shared: `new A().fn() === new A().fn()`.
#guard outcome
    [ aClass,
      .exprStmt (.binary .strictEq
        (.call (.member (.new (.ident "A") []) "fn") [])
        (.call (.member (.new (.ident "A") []) "fn") [])) ]
  == "true"

-- A method is not writable.
#guard outcome [aClass, .exprStmt (.call (.member (.new (.ident "A") []) "setM") [])]
  == "uncaught: TypeError: Private method '#m' is not writable"

/-- ```js
class G { get #x() { return 1; } w() { this.#x = 2; } }
class S { set #x(v) {} r() { return this.#x; } }
``` -/
private def halves : List Stmt :=
  [ cls "G"
      [ .method .getter false (.«private» "x") [] [.returnStmt (some (.numLit 1.0))],
        .method .method false "w" []
          [.exprStmt (.assign (.privateMember .this "x") (.numLit 2.0))] ],
    cls "S"
      [ .method .setter false (.«private» "x") ["v"] [],
        .method .method false "r" [] [.returnStmt (some (.privateMember .this "x"))] ] ]

#guard outcome (halves ++ [.exprStmt (.call (.member (.new (.ident "G") []) "w") [])])
  == "uncaught: TypeError: '#x' was defined without a setter"

#guard outcome (halves ++ [.exprStmt (.call (.member (.new (.ident "S") []) "r") [])])
  == "uncaught: TypeError: '#x' was defined without a getter"

/-! ## Brand, visibility, static, and order -/

/-- ```js
class B { #m() { return 1; } static probe(o) { return o.#m(); } }
class C {}
``` -/
private def brand : List Stmt :=
  [ cls "B"
      [ .method .method false (.«private» "m") [] [.returnStmt (some (.numLit 1.0))],
        .method .method true "probe" ["o"]
          [.returnStmt (some (.call (.privateMember (.ident "o") "m") []))] ],
    cls "C" [] ]

-- An instance of another class fails the brand check.
#guard outcome (brand ++ [.exprStmt (.call (.member (.ident "B") "probe") [.new (.ident "C") []])])
  == "uncaught: TypeError: Cannot read private member #m from an object whose class did not declare it"

-- `Object.keys(new B()).length === 0 && !("m" in new B())`: no property.
#guard outcome
    (brand ++
      [ .exprStmt (.logical .and
          (.binary .strictEq
            (.member (.call (.member (.ident "Object") "keys") [.new (.ident "B") []]) "length")
            (.numLit 0.0))
          (.unary .not (.binary .«in» (.strLit "m") (.new (.ident "B") [])))) ])
  == "true"

/-- ```js
class P { #m() { return 1; } static t(o) { return o.#m(); } }
class Q extends P { constructor() { super(); } }
``` -/
private def inherited : List Stmt :=
  [ cls "P"
      [ .method .method false (.«private» "m") [] [.returnStmt (some (.numLit 1.0))],
        .method .method true "t" ["o"]
          [.returnStmt (some (.call (.privateMember (.ident "o") "m") []))] ],
    .classDecl "Q"
      { name := some "Q", superClass := some (.ident "P"),
        elements := [ .ctor [] [.exprStmt (.superCall [])] ] } ]

-- `P.t(Object.create(new P()))`: the prototype has `#m`, the object does not.
#guard outcome
    (inherited ++
      [ .exprStmt (.call (.member (.ident "P") "t")
          [.call (.member (.ident "Object") "create") [.new (.ident "P") []]]) ])
  == "uncaught: TypeError: Cannot read private member #m from an object whose class did not declare it"

-- `P.t(new Q())`: an explicit `super()` installs the inherited brand.
#guard outcome (inherited ++ [.exprStmt (.call (.member (.ident "P") "t") [.new (.ident "Q") []])])
  == "1"

/-- ```js
class D {
  static #s() { return 7; }
  static use() { return D.#s(); }
  static p(o) { return o.#s(); }
}
``` -/
private def staticPrivate : Stmt :=
  cls "D"
    [ .method .method true (.«private» "s") [] [.returnStmt (some (.numLit 7.0))],
      .method .method true "use" []
        [.returnStmt (some (.call (.privateMember (.ident "D") "s") []))],
      .method .method true "p" ["o"]
        [.returnStmt (some (.call (.privateMember (.ident "o") "s") []))] ]

#guard outcome [staticPrivate, .exprStmt (.call (.member (.ident "D") "use") [])] == "7"

-- The static private method lives on the constructor, so an instance fails the brand check.
#guard outcome [staticPrivate, .exprStmt (.call (.member (.ident "D") "p") [.new (.ident "D") []])]
  == "uncaught: TypeError: Cannot read private member #s from an object whose class did not declare it"

-- `class H { static get #x() { return 4; } static set #x(v) {} static r() { return H.#x; } }`:
-- a static getter and setter of one name are one element, not a second add.
#guard outcome
    [ cls "H"
        [ .method .getter true (.«private» "x") [] [.returnStmt (some (.numLit 4.0))],
          .method .setter true (.«private» "x") ["v"] [],
          .method .method true "r" [] [.returnStmt (some (.privateMember (.ident "H") "x"))] ],
      .exprStmt (.call (.member (.ident "H") "r") []) ]
  == "4"

/-- ```js
class F { #v = this.#m(); #m() { return 3; } get v() { return this.#v; } }
``` — a field initializer may call a private method: methods go on first. -/
private def orderClass : Stmt :=
  cls "F"
    [ .field false (.«private» "v") (some (.call (.privateMember .this "m") [])),
      .method .method false (.«private» "m") [] [.returnStmt (some (.numLit 3.0))],
      .method .getter false "v" [] [.returnStmt (some (.privateMember .this "v"))] ]

#guard outcome [orderClass, .exprStmt (.member (.new (.ident "F") []) "v")] == "3"

/-- ```js
class Base { constructor(o) { return o; } }
class Stamp extends Base { #m() {} }
const o = {}; new Stamp(o); new Stamp(o);
``` — the return-override trick stamps `#m` once; twice is a `TypeError`. -/
private def stamp : List Stmt :=
  [ cls "Base" [ .ctor ["o"] [.returnStmt (some (.ident "o"))] ],
    .classDecl "Stamp"
      { name := some "Stamp", superClass := some (.ident "Base"),
        elements := [ .method .method false (.«private» "m") [] [] ] },
    letConst "o" (.objectLit []),
    .exprStmt (.new (.ident "Stamp") [.ident "o"]),
    .exprStmt (.new (.ident "Stamp") [.ident "o"]) ]

#guard outcome stamp == "uncaught: TypeError: Cannot initialize private methods twice on the same object"

/- ```js
class P { #m() { return 1; } }
class Q extends P { probe() { return this.#m(); } }
``` — `#m` is not in `Q`'s scope: a `SyntaxError` at the use, not a walk. -/
#guard outcome
    [ cls "P" [ .method .method false (.«private» "m") [] [.returnStmt (some (.numLit 1.0))] ],
      .classDecl "Q"
        { name := some "Q", superClass := some (.ident "P"),
          elements := [ .method .method false "probe" []
            [.returnStmt (some (.call (.privateMember .this "m") []))] ] },
      .exprStmt (.call (.member (.new (.ident "Q") []) "probe") []) ]
  == "uncaught: SyntaxError: Private field '#m' must be declared in an enclosing class"

/-! ## The brand check `#x in o` -/

/-- ```js
class A {
  #f = 1;
  #m() {}
  get #g() { throw new Error("called"); }
  static #s = 1;
  static f(o) { return #f in o; }
  static m(o) { return #m in o; }
  static g(o) { return #g in o; }
  static s(o) { return #s in o; }
}
``` -/
private def brandIn : Stmt :=
  cls "A"
    [ .field false (.«private» "f") (some (.numLit 1.0)),
      .method .method false (.«private» "m") [] [],
      .method .getter false (.«private» "g") []
        [.throwStmt (.new (.ident "Error") [.strLit "called"])],
      .field true (.«private» "s") (some (.numLit 1.0)),
      .method .method true "f" ["o"] [.returnStmt (some (.privateIn "f" (.ident "o")))],
      .method .method true "m" ["o"] [.returnStmt (some (.privateIn "m" (.ident "o")))],
      .method .method true "g" ["o"] [.returnStmt (some (.privateIn "g" (.ident "o")))],
      .method .method true "s" ["o"] [.returnStmt (some (.privateIn "s" (.ident "o")))] ]

private def askA (member : String) (arg : Expr) : List Stmt :=
  [brandIn, .exprStmt (.call (.member (.ident "A") member) [arg])]

-- A field, a method, and an accessor are each found on an instance.
#guard outcome (askA "f" (.new (.ident "A") [])) == "true"
#guard outcome (askA "m" (.new (.ident "A") [])) == "true"
-- Presence only: the getter is not called.
#guard outcome (askA "g" (.new (.ident "A") [])) == "true"

-- An object without the element answers false.
#guard outcome (askA "f" (.objectLit [])) == "false"

-- A static element is on the constructor, not on an instance.
#guard outcome (askA "s" (.ident "A")) == "true"
#guard outcome (askA "s" (.new (.ident "A") [])) == "false"

-- A primitive right operand is a TypeError.
#guard outcome (askA "f" (.numLit 1.0))
  == "uncaught: TypeError: Cannot use 'in' operator to search for '#f' in 1"
#guard outcome (askA "f" .nullLit)
  == "uncaught: TypeError: Cannot use 'in' operator to search for '#f' in null"

/-- ```js
class O {
  #x;
  static inner() { return class I { #x; static h(o) { return #x in o; } }; }
}
``` -/
private def shadow : Stmt :=
  cls "O"
    [ .field false (.«private» "x") none,
      .method .method true "inner" []
        [.returnStmt (some (.classExpr
          { name := some "I", superClass := none,
            elements :=
              [ .field false (.«private» "x") none,
                .method .method true "h" ["o"]
                  [.returnStmt (some (.privateIn "x" (.ident "o")))] ] }))] ]

-- `O.inner().h(new O())`: the inner `#x` is a name of its own.
#guard outcome
    [ shadow,
      .exprStmt (.call (.member (.call (.member (.ident "O") "inner") []) "h")
        [.new (.ident "O") []]) ]
  == "false"
