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
