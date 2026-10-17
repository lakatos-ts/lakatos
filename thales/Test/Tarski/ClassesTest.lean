import Tarski.Eval
import Tarski.Format

/-! Classes: declarations and expressions, constructors, public and
private fields, methods, getters and setters, `static`, `extends`, and
`super`.

The two acceptance cases of #384 open the file: the issue's own example,
and the three class fixtures `thales` proves `Theorem`s over —
`thales/tests/fixtures/classes.ts` — transcribed as terms with
one witness per `@ensures`, so `lake build TarskiTest` checks the
fragment those proofs are about without running Node.

What is refused rather than evaluated is `Tarski/Decode.lean`'s business
and pinned there: a computed key, a decorator, and `new.target` never
reach an AST. Private methods and accessors are
`Test/Tarski/PrivateElementsTest.lean`'s. What is *out of scope* is
descriptors (#389), so `Object.keys` still lists a method and a
class's `name` does not exist; its `length` is #393's and does, which
`Test/Tarski/ParamsTest.lean` pins. -/

open Tarski

/-- What the binary would print, so a case reads as its own stdout. -/
private def outcome (p : Program) : String :=
  match runScript p with
  | none => "<diverges>"
  | some (.error (.throw v), h) => s!"uncaught: {describeThrown h v}"
  | some (.error _, _) => "<abrupt>"
  | some (.ok none, _) => "<empty>"
  | some (.ok (some v), _) => formatValue v

/-- A class declaration with no heritage. -/
private def cls (name : String) (elements : List ClassElement) : Stmt :=
  .classDecl name { name := some name, superClass := none, elements }

/-- A class declaration extending a named binding. -/
private def subcls (name parent : String) (elements : List ClassElement) : Stmt :=
  .classDecl name { name := some name, superClass := some (.ident parent), elements }

/-- `const <name> = <e>;` -/
private def letConst (name : String) (e : Expr) : Stmt :=
  .varDecl .«const» [{ target := name, init := some e }]

/-! ## The issue's example -/

/-- ```js
class Box {
  #v;
  constructor(v) { if (v < 0) throw new RangeError("neg"); this.#v = v; }
  get v() { return this.#v; }
  scale(k) { return new Box(this.#v * k); }
}
``` -/
private def boxClass : Stmt :=
  cls "Box"
    [ .field false (.«private» "v") none,
      .ctor ["v"]
        [ .ifStmt (.binary .lt (.ident "v") (.numLit 0.0))
            (.throwStmt (.new (.ident "RangeError") [.strLit "neg"])) none,
          .exprStmt (.assign (.privateMember .this "v") (.ident "v")) ],
      .method .getter false "v" [] [.returnStmt (some (.privateMember .this "v"))],
      .method .method false "scale" ["k"]
        [ .returnStmt (some (.new (.ident "Box")
            [.binary .mul (.privateMember .this "v") (.ident "k")])) ] ]

-- `const b = new Box(2).scale(3); b.v === 6 && b instanceof Box;`
#guard outcome
    [ boxClass,
      letConst "b" (.call (.member (.new (.ident "Box") [.numLit 2.0]) "scale") [.numLit 3.0]),
      .exprStmt (.logical .and
        (.binary .strictEq (.member (.ident "b") "v") (.numLit 6.0))
        (.binary .instanceof (.ident "b") (.ident "Box"))) ]
  == "true"

-- `new Box(-1);` — the constructor's own throw escapes `new`.
#guard outcome [boxClass, .exprStmt (.new (.ident "Box") [.unary .neg (.numLit 1.0)])]
  == "uncaught: RangeError: neg"

/-! ## The emitter's class fixtures

`thales/tests/fixtures/classes.ts` stripped of its type
annotations, with each `@ensures` instantiated at one witness. This is
the fragment the prover's `Theorem`s are about, so the evaluator has to
agree with them. -/

/-- `class Box { #v; constructor(v) { this.#v = v; } get v() { return this.#v; } }` -/
private def fixtureBox : Stmt :=
  cls "FBox"
    [ .field false (.«private» "v") none,
      .ctor ["v"] [.exprStmt (.assign (.privateMember .this "v") (.ident "v"))],
      .method .getter false "v" [] [.returnStmt (some (.privateMember .this "v"))] ]

/-- `class Gate { #lo; constructor(a) { if (a < 0) { throw new RangeError("negative"); }
else { this.#lo = a; } } get lo() { return this.#lo; } }` -/
private def fixtureGate : Stmt :=
  cls "Gate"
    [ .field false (.«private» "lo") none,
      .ctor ["a"]
        [ .ifStmt (.binary .lt (.ident "a") (.numLit 0.0))
            (.block [.throwStmt (.new (.ident "RangeError") [.strLit "negative"])])
            (some (.block [.exprStmt (.assign (.privateMember .this "lo") (.ident "a"))])) ],
      .method .getter false "lo" [] [.returnStmt (some (.privateMember .this "lo"))] ]

/-- `class Doubler { #v; constructor(v) { this.#v = v; } double() { return this.#v * 2; }
base() { return this.#v; } twice() { return this.base() + this.base(); } }` -/
private def fixtureDoubler : Stmt :=
  cls "Doubler"
    [ .field false (.«private» "v") none,
      .ctor ["v"] [.exprStmt (.assign (.privateMember .this "v") (.ident "v"))],
      .method .method false "double" []
        [.returnStmt (some (.binary .mul (.privateMember .this "v") (.numLit 2.0)))],
      .method .method false "base" [] [.returnStmt (some (.privateMember .this "v"))],
      .method .method false "twice" []
        [ .returnStmt (some (.binary .add
            (.call (.member .this "base") []) (.call (.member .this "base") []))) ] ]

/-- `Object.is(a, b)` -/
private def objectIs (a b : Expr) : Expr :=
  .call (.member (.ident "Object") "is") [a, b]

-- The four `@ensures` of `classes.ts`, each at one witness:
-- `Object.is(new Box(2).v, 2) && Object.is(new Gate(3).lo, 3)
--   && Object.is(new Doubler(4).double(), 8) && Object.is(new Doubler(4).twice(), 8);`
#guard outcome
    [ fixtureBox, fixtureGate, fixtureDoubler,
      .exprStmt (.logical .and
        (.logical .and
          (objectIs (.member (.new (.ident "FBox") [.numLit 2.0]) "v") (.numLit 2.0))
          (objectIs (.member (.new (.ident "Gate") [.numLit 3.0]) "lo") (.numLit 3.0)))
        (.logical .and
          (objectIs (.call (.member (.new (.ident "Doubler") [.numLit 4.0]) "double") [])
            (.numLit 8.0))
          (objectIs (.call (.member (.new (.ident "Doubler") [.numLit 4.0]) "twice") [])
            (.numLit 8.0)))) ]
  == "true"

-- `new Gate(-1);` — `Gate`'s guard, the one `@ensures{keepsValue}` puts a
-- hypothesis in front of.
#guard outcome [fixtureGate, .exprStmt (.new (.ident "Gate") [.unary .neg (.numLit 1.0)])]
  == "uncaught: RangeError: negative"

/-! ## Public fields -/

-- `class A { x = 1; y; } const a = new A(); a.x + ":" + a.y;` — a field
-- without an initializer is `undefined`, not absent.
#guard outcome
    [ cls "A" [.field false (.«public» "x") (some (.numLit 1.0)),
               .field false (.«public» "y") none],
      letConst "a" (.new (.ident "A") []),
      .exprStmt (.binary .add
        (.binary .add (.member (.ident "a") "x") (.strLit ":"))
        (.member (.ident "a") "y")) ]
  == "1:undefined"

-- `class A { x = 2; y = this.x * 3; } new A().y;` — an initializer sees
-- `this` and the fields already defined on it.
#guard outcome
    [ cls "A" [.field false (.«public» "x") (some (.numLit 2.0)),
               .field false (.«public» "y")
                 (some (.binary .mul (.member .this "x") (.numLit 3.0)))],
      .exprStmt (.member (.new (.ident "A") []) "y") ]
  == "6"

-- `class A { x = 1; f = () => this.x; } new A().f();` — an arrow in an
-- initializer captures the instance lexically.
#guard outcome
    [ cls "A" [.field false (.«public» "x") (some (.numLit 1.0)),
               .field false (.«public» "f")
                 (some (.arrow [] (.expr (.member .this "x"))))],
      .exprStmt (.call (.member (.new (.ident "A") []) "f") []) ]
  == "1"

-- `class A { x = 1; } const a = new A(); const b = new A(); a.x = 9; b.x;`
-- — the initializer runs once per instance.
#guard outcome
    [ cls "A" [.field false (.«public» "x") (some (.numLit 1.0))],
      letConst "a" (.new (.ident "A") []),
      letConst "b" (.new (.ident "A") []),
      .exprStmt (.assign (.member (.ident "a") "x") (.numLit 9.0)),
      .exprStmt (.member (.ident "b") "x") ]
  == "1"

-- `class A { set x(v) { this.hit = true; } x = 1; } new A().hit;` — a
-- field is a *definition*, so the prototype's setter is not called and
-- `hit` was never written.
#guard outcome
    [ cls "A" [.method .setter false "x" ["v"]
                 [.exprStmt (.assign (.member .this "hit") (.boolLit true))],
               .field false (.«public» "x") (some (.numLit 1.0))],
      .exprStmt (.member (.new (.ident "A") []) "hit") ]
  == "undefined"

/-! ## Private fields -/

-- `class A { #v = 1; static peek(o) { return o.#v; } } A.peek(new A());`
#guard outcome
    [ cls "A" [.field false (.«private» "v") (some (.numLit 1.0)),
               .method .method true "peek" ["o"]
                 [.returnStmt (some (.privateMember (.ident "o") "v"))]],
      .exprStmt (.call (.member (.ident "A") "peek") [.new (.ident "A") []]) ]
  == "1"

-- `A.peek({});` — the brand check: an object the class did not build has
-- no element under that name.
#guard outcome
    [ cls "A" [.field false (.«private» "v") (some (.numLit 1.0)),
               .method .method true "peek" ["o"]
                 [.returnStmt (some (.privateMember (.ident "o") "v"))]],
      .exprStmt (.call (.member (.ident "A") "peek") [.objectLit []]) ]
  == "uncaught: TypeError: Cannot read private member #v from an object whose class did not declare it"

-- `const mk = () => class { #v = 1; static peek(o) { return o.#v; } };
--  mk().peek(new (mk())());` — **two evaluations of one class text declare
--  two different private names**, so the second class's instance has no
--  element the first class can read.
#guard outcome
    [ letConst "mk" (.arrow [] (.expr (.classExpr
        { name := none, superClass := none,
          elements := [.field false (.«private» "v") (some (.numLit 1.0)),
                       .method .method true "peek" ["o"]
                         [.returnStmt (some (.privateMember (.ident "o") "v"))]] }))),
      .exprStmt (.call (.member (.call (.ident "mk") []) "peek")
        [.new (.call (.ident "mk") []) []]) ]
  == "uncaught: TypeError: Cannot read private member #v from an object whose class did not declare it"

-- `class A { #v = 1; bump() { this.#v = this.#v + 1; return this.#v; } } new A().bump();`
#guard outcome
    [ cls "A" [.field false (.«private» "v") (some (.numLit 1.0)),
               .method .method false "bump" []
                 [ .exprStmt (.assign (.privateMember .this "v")
                     (.binary .add (.privateMember .this "v") (.numLit 1.0))),
                   .returnStmt (some (.privateMember .this "v")) ]],
      .exprStmt (.call (.member (.new (.ident "A") []) "bump") []) ]
  == "2"

-- `class A { static #count = 7; static peek() { return A.#count; } } A.peek();`
-- — a static private field lives on the constructor object.
#guard outcome
    [ cls "A" [.field true (.«private» "count") (some (.numLit 7.0)),
               .method .method true "peek" []
                 [.returnStmt (some (.privateMember (.ident "A") "count"))]],
      .exprStmt (.call (.member (.ident "A") "peek") []) ]
  == "7"

-- `class A { #v = 1; m() { return this.#v; } } const f = new A().m; f();`
-- — a method called bare has `this` of `undefined` in strict mode, so the
-- private read is the brand check's `TypeError`.
#guard outcome
    [ cls "A" [.field false (.«private» "v") (some (.numLit 1.0)),
               .method .method false "m" [] [.returnStmt (some (.privateMember .this "v"))]],
      letConst "f" (.member (.new (.ident "A") []) "m"),
      .exprStmt (.call (.ident "f") []) ]
  == "uncaught: TypeError: Cannot read private member #v from an object whose class did not declare it"

-- `class A { m() { return this; } } const f = new A().m; typeof f();`
#guard outcome
    [ cls "A" [.method .method false "m" [] [.returnStmt (some .this)]],
      letConst "f" (.member (.new (.ident "A") []) "m"),
      .exprStmt (.unary .typeof (.call (.ident "f") [])) ]
  == "undefined"

/-! ## Methods -/

/-- `class A { m() { return 1; } }`, the class the method cases read. -/
private def classWithM : Stmt :=
  cls "A" [.method .method false "m" [] [.returnStmt (some (.numLit 1.0))]]

-- `typeof A.prototype.m;`
#guard outcome
    [classWithM, .exprStmt (.unary .typeof (.member (.member (.ident "A") "prototype") "m"))]
  == "function"

-- `new A().m === A.prototype.m;` — the method lives on the prototype, not
-- on each instance.
#guard outcome
    [ classWithM,
      .exprStmt (.binary .strictEq
        (.member (.new (.ident "A") []) "m")
        (.member (.member (.ident "A") "prototype") "m")) ]
  == "true"

-- `A.prototype.m.prototype;` — a method has none.
#guard outcome
    [classWithM, .exprStmt (.member (.member (.member (.ident "A") "prototype") "m") "prototype")]
  == "undefined"

-- `new (new A().m)();` — and so cannot be constructed.
#guard outcome [classWithM, .exprStmt (.new (.member (.new (.ident "A") []) "m") [])]
  == "uncaught: TypeError: not a constructor"

-- `A();` — a class constructor is not callable.
#guard outcome [classWithM, .exprStmt (.call (.ident "A") [])]
  == "uncaught: TypeError: Class constructor cannot be invoked without 'new'"

-- `typeof A;`
#guard outcome [classWithM, .exprStmt (.unary .typeof (.ident "A"))] == "function"

-- `A.prototype.constructor === A;`
#guard outcome
    [ classWithM,
      .exprStmt (.binary .strictEq
        (.member (.member (.ident "A") "prototype") "constructor") (.ident "A")) ]
  == "true"

-- `class A { m() { return this.x; } } const a = new A(); a.x = 5; a.m();`
-- — a method's `this` is its receiver.
#guard outcome
    [ cls "A" [.method .method false "m" [] [.returnStmt (some (.member .this "x"))]],
      letConst "a" (.new (.ident "A") []),
      .exprStmt (.assign (.member (.ident "a") "x") (.numLit 5.0)),
      .exprStmt (.call (.member (.ident "a") "m") []) ]
  == "5"

-- `class A { static constructor() { return 1; } } A.constructor();` — a
-- `static constructor` is an ordinary static method of that name, not the
-- class's constructor.
#guard outcome
    [ cls "A" [.method .method true "constructor" [] [.returnStmt (some (.numLit 1.0))]],
      .exprStmt (.call (.member (.ident "A") "constructor") []) ]
  == "1"

/-! ## Getters and setters -/

-- `class A { #v = 3; get x() { return this.#v; } } new A().x;`
#guard outcome
    [ cls "A" [.field false (.«private» "v") (some (.numLit 3.0)),
               .method .getter false "x" [] [.returnStmt (some (.privateMember .this "v"))]],
      .exprStmt (.member (.new (.ident "A") []) "x") ]
  == "3"

-- `class A { set x(v) { this.seen = v; } } const a = new A(); a.x = 4; a.seen;`
#guard outcome
    [ cls "A" [.method .setter false "x" ["v"]
                 [.exprStmt (.assign (.member .this "seen") (.ident "v"))]],
      letConst "a" (.new (.ident "A") []),
      .exprStmt (.assign (.member (.ident "a") "x") (.numLit 4.0)),
      .exprStmt (.member (.ident "a") "seen") ]
  == "4"

-- `class A { get x() { return this.v; } set x(w) { this.v = w * 2; } }
--  const a = new A(); a.x = 4; a.x;` — a `get x` and a `set x` are the two
--  halves of one property.
#guard outcome
    [ cls "A" [.method .getter false "x" [] [.returnStmt (some (.member .this "v"))],
               .method .setter false "x" ["w"]
                 [.exprStmt (.assign (.member .this "v")
                   (.binary .mul (.ident "w") (.numLit 2.0)))]],
      letConst "a" (.new (.ident "A") []),
      .exprStmt (.assign (.member (.ident "a") "x") (.numLit 4.0)),
      .exprStmt (.member (.ident "a") "x") ]
  == "8"

-- `class A { get x() { return 1; } } new A().x = 2;` — strict mode, so a
-- write through a getter-only accessor refuses.
#guard outcome
    [ cls "A" [.method .getter false "x" [] [.returnStmt (some (.numLit 1.0))]],
      .exprStmt (.assign (.member (.new (.ident "A") []) "x") (.numLit 2.0)) ]
  == "uncaught: TypeError: Cannot set property x of #<Object> which has only a getter"

-- `class A { get self() { return this; } } const a = new A(); a.self === a;`
-- — a getter found on the prototype still runs on the instance.
#guard outcome
    [ cls "A" [.method .getter false "self" [] [.returnStmt (some .this)]],
      letConst "a" (.new (.ident "A") []),
      .exprStmt (.binary .strictEq (.member (.ident "a") "self") (.ident "a")) ]
  == "true"

-- `class A { get x() { return 1; } } class B extends A {} new B().x;` — and
-- is found two links up just as well.
#guard outcome
    [ cls "A" [.method .getter false "x" [] [.returnStmt (some (.numLit 1.0))]],
      subcls "B" "A" [],
      .exprStmt (.member (.new (.ident "B") []) "x") ]
  == "1"

-- `class A { m() {} get x() { return 1; } } Object.keys(A.prototype).join();`
-- — `constructor` and every class element are non-enumerable (15.4.4),
-- so a class prototype lists nothing.
-- `Test/Tarski/ObjectReflectionTest.lean` pins the keys that *are*
-- there.
#guard outcome
    [ cls "A" [.method .method false "m" [] [],
               .method .getter false "x" [] [.returnStmt (some (.numLit 1.0))]],
      .exprStmt (.call (.member
        (.call (.member (.ident "Object") "keys") [.member (.ident "A") "prototype"])
        "join") []) ]
  == ""

/-! ## `static` -/

-- `class A { static make() { return new this(); } } A.make() instanceof A;`
-- — a static method's `this` is the class it was called on.
#guard outcome
    [ cls "A" [.method .method true "make" [] [.returnStmt (some (.new .this []))]],
      .exprStmt (.binary .instanceof (.call (.member (.ident "A") "make") []) (.ident "A")) ]
  == "true"

-- `class A { static x = 1; } A.x;`
#guard outcome [cls "A" [.field true (.«public» "x") (some (.numLit 1.0))],
                .exprStmt (.member (.ident "A") "x")]
  == "1"

-- `class A { static x = 1; static y = this.x + 1; } A.y;` — a static
-- initializer's `this` is the constructor object.
#guard outcome
    [ cls "A" [.field true (.«public» "x") (some (.numLit 1.0)),
               .field true (.«public» "y")
                 (some (.binary .add (.member .this "x") (.numLit 1.0)))],
      .exprStmt (.member (.ident "A") "y") ]
  == "2"

-- `class A { static make() { return new this(); } } class B extends A {}
--  B.make() instanceof B;` — the constructor object's own prototype is the
--  parent constructor, so statics are inherited and `this` is `B`.
#guard outcome
    [ cls "A" [.method .method true "make" [] [.returnStmt (some (.new .this []))]],
      subcls "B" "A" [],
      .exprStmt (.binary .instanceof (.call (.member (.ident "B") "make") []) (.ident "B")) ]
  == "true"

/-! ## `extends` and `super` -/

-- `class A { constructor() { this.x = 1; } } class B extends A {}
--  const b = new B(); b.x + ":" + (b instanceof A) + ":" + (b instanceof B);`
-- — the default derived constructor forwards to the parent, and the
-- instance's prototype is the *child's*.
#guard outcome
    [ cls "A" [.ctor [] [.exprStmt (.assign (.member .this "x") (.numLit 1.0))]],
      subcls "B" "A" [],
      letConst "b" (.new (.ident "B") []),
      .exprStmt (.binary .add
        (.binary .add
          (.binary .add (.binary .add (.member (.ident "b") "x") (.strLit ":"))
            (.binary .instanceof (.ident "b") (.ident "A")))
          (.strLit ":"))
        (.binary .instanceof (.ident "b") (.ident "B"))) ]
  == "1:true:true"

-- `class A { constructor(v) { this.x = v; } } class B extends A {} new B(5).x;`
-- — and forwards its arguments.
#guard outcome
    [ cls "A" [.ctor ["v"] [.exprStmt (.assign (.member .this "x") (.ident "v"))]],
      subcls "B" "A" [],
      .exprStmt (.member (.new (.ident "B") [.numLit 5.0]) "x") ]
  == "5"

-- `class A { constructor(v) { this.x = v; } }
--  class B extends A { constructor(v) { super(v); this.y = v + 1; } }
--  const b = new B(1); b.x + ":" + b.y;`
#guard outcome
    [ cls "A" [.ctor ["v"] [.exprStmt (.assign (.member .this "x") (.ident "v"))]],
      subcls "B" "A"
        [ .ctor ["v"]
            [ .exprStmt (.superCall [.ident "v"]),
              .exprStmt (.assign (.member .this "y")
                (.binary .add (.ident "v") (.numLit 1.0))) ] ],
      letConst "b" (.new (.ident "B") [.numLit 1.0]),
      .exprStmt (.binary .add
        (.binary .add (.member (.ident "b") "x") (.strLit ":")) (.member (.ident "b") "y")) ]
  == "1:2"

-- `class A { m() { return 1; } } class B extends A { m() { return super.m() + 1; } }
--  new B().m();` — an override reaching the one it overrode.
#guard outcome
    [ cls "A" [.method .method false "m" [] [.returnStmt (some (.numLit 1.0))]],
      subcls "B" "A"
        [.method .method false "m" []
          [.returnStmt (some (.binary .add (.call (.superMember "m") []) (.numLit 1.0)))]],
      .exprStmt (.call (.member (.new (.ident "B") []) "m") []) ]
  == "2"

-- `class A { static m() { return 1; } } class B extends A { static m() { return super.m() + 1; } }
--  B.m();` — `super` in a static method reads through the constructor.
#guard outcome
    [ cls "A" [.method .method true "m" [] [.returnStmt (some (.numLit 1.0))]],
      subcls "B" "A"
        [.method .method true "m" []
          [.returnStmt (some (.binary .add (.call (.superMember "m") []) (.numLit 1.0)))]],
      .exprStmt (.call (.member (.ident "B") "m") []) ]
  == "2"

-- `class A { get x() { return this.v; } }
--  class B extends A { m() { return super.x; } }
--  const b = new B(); b.v = 9; b.m();` — a parent getter reached through
-- `super` still has the *child* as its receiver.
#guard outcome
    [ cls "A" [.method .getter false "x" [] [.returnStmt (some (.member .this "v"))]],
      subcls "B" "A" [.method .method false "m" [] [.returnStmt (some (.superMember "x"))]],
      letConst "b" (.new (.ident "B") []),
      .exprStmt (.assign (.member (.ident "b") "v") (.numLit 9.0)),
      .exprStmt (.call (.member (.ident "b") "m") []) ]
  == "9"

-- `class A { m() { return 1; } } class B extends A { m() { return super["m"]() + 1; } }
--  new B().m();` — the computed spelling of the same reference.
#guard outcome
    [ cls "A" [.method .method false "m" [] [.returnStmt (some (.numLit 1.0))]],
      subcls "B" "A"
        [.method .method false "m" []
          [.returnStmt (some (.binary .add
            (.call (.superIndex (.strLit "m")) []) (.numLit 1.0)))]],
      .exprStmt (.call (.member (.new (.ident "B") []) "m") []) ]
  == "2"

-- `class A {} class B extends A { constructor() { this.x = 1; } } new B();`
-- — `this` before `super()` is the derived constructor's dead zone.
#guard outcome
    [ cls "A" [],
      subcls "B" "A" [.ctor [] [.exprStmt (.assign (.member .this "x") (.numLit 1.0))]],
      .exprStmt (.new (.ident "B") []) ]
  == ("uncaught: ReferenceError: Must call super constructor in derived class " ++
      "before accessing 'this' or returning from derived constructor")

-- `class A {} class B extends A { constructor() {} } new B();` — and so is
-- a derived constructor that returns without calling it.
#guard outcome [cls "A" [], subcls "B" "A" [.ctor [] []], .exprStmt (.new (.ident "B") [])]
  == ("uncaught: ReferenceError: Must call super constructor in derived class " ++
      "before accessing 'this' or returning from derived constructor")

-- `class A {} class B extends A { constructor() { super(); super(); } } new B();`
#guard outcome
    [ cls "A" [],
      subcls "B" "A" [.ctor [] [.exprStmt (.superCall []), .exprStmt (.superCall [])]],
      .exprStmt (.new (.ident "B") []) ]
  == "uncaught: ReferenceError: Super constructor may only be called once"

-- `class A {} class B extends A { constructor() { super(); return { tag: 1 }; } }
--  new B().tag;` — a derived constructor may return an object, which wins.
#guard outcome
    [ cls "A" [],
      subcls "B" "A"
        [.ctor [] [.exprStmt (.superCall []),
                   .returnStmt (some (.objectLit [.init "tag" (.numLit 1.0)]))]],
      .exprStmt (.member (.new (.ident "B") []) "tag") ]
  == "1"

-- `class A {} class B extends A { constructor() { super(); return 1; } } new B();`
-- — but not a primitive other than `undefined`.
#guard outcome
    [ cls "A" [],
      subcls "B" "A" [.ctor [] [.exprStmt (.superCall []), .returnStmt (some (.numLit 1.0))]],
      .exprStmt (.new (.ident "B") []) ]
  == "uncaught: TypeError: Derived constructors may only return object or undefined"

-- `class A { constructor() { this.x = 1; return 1; } } new A().x;` — a base
-- constructor's primitive return is ignored.
#guard outcome
    [ cls "A" [.ctor [] [.exprStmt (.assign (.member .this "x") (.numLit 1.0)),
                         .returnStmt (some (.numLit 1.0))]],
      .exprStmt (.member (.new (.ident "A") []) "x") ]
  == "1"

-- `class A { constructor() { this.seen = this.x; } } class B extends A { x = 1; }
--  new B().seen;` — a child's fields are initialized *after* `super()`
--  returns, so the parent cannot see them.
#guard outcome
    [ cls "A" [.ctor [] [.exprStmt (.assign (.member .this "seen") (.member .this "x"))]],
      subcls "B" "A" [.field false (.«public» "x") (some (.numLit 1.0))],
      .exprStmt (.member (.new (.ident "B") []) "seen") ]
  == "undefined"

-- `class E extends Error { constructor(m) { super(m); this.name = "E"; } }
--  try { throw new E("boom"); } catch (e) {
--    e instanceof E && e instanceof Error && e.message === "boom" && String(e) === "E: boom"; }`
-- — NewTarget through a native: the instance's prototype is `E.prototype`.
#guard outcome
    [ .classDecl "E"
        { name := some "E", superClass := some (.ident "Error"),
          elements := [.ctor ["m"] [.exprStmt (.superCall [.ident "m"]),
                                    .exprStmt (.assign (.member .this "name") (.strLit "E"))]] },
      .tryStmt [.throwStmt (.new (.ident "E") [.strLit "boom"])]
        (some { param := some "e",
                body := [.exprStmt (.logical .and
                  (.logical .and
                    (.binary .instanceof (.ident "e") (.ident "E"))
                    (.binary .instanceof (.ident "e") (.ident "Error")))
                  (.logical .and
                    (.binary .strictEq (.member (.ident "e") "message") (.strLit "boom"))
                    (.binary .strictEq (.call (.ident "String") [.ident "e"])
                      (.strLit "E: boom"))))] })
        none ]
  == "true"

-- `class A extends Array {} const a = new A(1, 2); a.length + ":" + (a instanceof A);`
-- — and through `Array`, whose exotic behaviour the instance keeps.
#guard outcome
    [ .classDecl "A" { name := some "A", superClass := some (.ident "Array"), elements := [] },
      letConst "a" (.new (.ident "A") [.numLit 1.0, .numLit 2.0]),
      .exprStmt (.binary .add
        (.binary .add (.member (.ident "a") "length") (.strLit ":"))
        (.binary .instanceof (.ident "a") (.ident "A"))) ]
  == "2:true"

-- `class A extends 1 {}`
#guard outcome
    [.classDecl "A" { name := some "A", superClass := some (.numLit 1.0), elements := [] }]
  == "uncaught: TypeError: Class extends value 1 is not a constructor or null"

-- `function F() {} F.prototype = 1; class A extends F {}`
#guard outcome
    [ .funcDecl "F" [] [],
      .exprStmt (.assign (.member (.ident "F") "prototype") (.numLit 1.0)),
      .classDecl "A" { name := some "A", superClass := some (.ident "F"), elements := [] } ]
  == "uncaught: TypeError: Class extends value does not have valid prototype property 1"

-- `class A extends null {} new A();` — `extends null` gives the
-- constructor `%Function.prototype%` as its `[[Prototype]]` (15.7.14
-- step 10.b), which is callable and not constructible, so the implicit
-- derived constructor has nothing to forward to.
#guard outcome
    [ .classDecl "A" { name := some "A", superClass := some .nullLit, elements := [] },
      .exprStmt (.new (.ident "A") []) ]
  == "uncaught: TypeError: Super constructor null of anonymous class is not a constructor"

-- `class A extends null { constructor() { return {}; } } typeof new A();` —
-- the return-override trick is the one way to construct one.
#guard outcome
    [ .classDecl "A"
        { name := some "A", superClass := some .nullLit,
          elements := [.ctor [] [.returnStmt (some (.objectLit []))]] },
      .exprStmt (.unary .typeof (.new (.ident "A") [])) ]
  == "object"

-- `class D extends Object { constructor() { super[super()]; } } new D();`
-- — MakeSuperPropertyReference reads the `this` binding *before* it
-- evaluates the key, so this is the dead zone and not a read through
-- whatever the inner `super()` would have bound.
#guard outcome
    [ .classDecl "D"
        { name := some "D", superClass := some (.ident "Object"),
          elements := [.ctor [] [.exprStmt (.superIndex (.superCall []))]] },
      .exprStmt (.new (.ident "D") []) ]
  == ("uncaught: ReferenceError: Must call super constructor in derived class " ++
      "before accessing 'this' or returning from derived constructor")

-- `function f() { return super.x; } f();` — `super` with no home object.
#guard outcome
    [ .funcDecl "f" [] [.returnStmt (some (.superMember "x"))],
      .exprStmt (.call (.ident "f") []) ]
  == "uncaught: SyntaxError: 'super' keyword unexpected here"

/-! ## Bindings -/

-- `new A(); class A {}` — a class declaration is hoisted like a `let`, so
-- the binding exists and is in its dead zone.
#guard outcome [.exprStmt (.new (.ident "A") []), cls "A" []]
  == "uncaught: ReferenceError: Cannot access 'A' before initialization"

-- `class A {} A = 1; A;` — the *declaration's* binding is writable.
#guard outcome
    [cls "A" [], .exprStmt (.assign (.ident "A") (.numLit 1.0)), .exprStmt (.ident "A")]
  == "1"

-- `const C = class Named { m() { return Named; } }; new C().m() === C;` — a
-- named class expression binds its own name inside the body.
#guard outcome
    [ letConst "C" (.classExpr
        { name := some "Named", superClass := none,
          elements := [.method .method false "m" [] [.returnStmt (some (.ident "Named"))]] }),
      .exprStmt (.binary .strictEq (.call (.member (.new (.ident "C") []) "m") []) (.ident "C")) ]
  == "true"

-- `const C = class Named { m() { Named = 1; } }; new C().m();` — and that
-- binding is immutable.
#guard outcome
    [ letConst "C" (.classExpr
        { name := some "Named", superClass := none,
          elements := [.method .method false "m" []
            [.exprStmt (.assign (.ident "Named") (.numLit 1.0))]] }),
      .exprStmt (.call (.member (.new (.ident "C") []) "m") []) ]
  == "uncaught: TypeError: Assignment to constant variable."

-- `const C = class Named {}; typeof Named;` — and is scoped to the class.
#guard outcome
    [ letConst "C" (.classExpr { name := some "Named", superClass := none, elements := [] }),
      .exprStmt (.unary .typeof (.ident "Named")) ]
  == "undefined"

-- `const C = class { m() { return 1; } }; new C().m();` — an anonymous
-- class expression.
#guard outcome
    [ letConst "C" (.classExpr
        { name := none, superClass := none,
          elements := [.method .method false "m" [] [.returnStmt (some (.numLit 1.0))]] }),
      .exprStmt (.call (.member (.new (.ident "C") []) "m") []) ]
  == "1"

-- `1; class A {}` — a class declaration completes empty, as a function
-- declaration does, so the running completion value stands.
#guard outcome [.exprStmt (.numLit 1.0), cls "A" []] == "1"

/-! ## Static blocks -/

/-- ```js
class S {
  static a = 1;
  static { S.b = S.a + 1; S.self = this === S; }
  static c = S.b + 1;
  static { var hidden = 5; S.d = hidden; }
}
S.b === 2 && S.c === 3 && S.self && S.d === 5 && typeof hidden === "undefined"
``` -/
private def staticBlocks : Stmt :=
  cls "S"
    [ .field true "a" (some (.numLit 1.0)),
      .staticBlock
        [ .exprStmt (.assign (.member (.ident "S") "b")
            (.binary .add (.member (.ident "S") "a") (.numLit 1.0))),
          .exprStmt (.assign (.member (.ident "S") "self")
            (.binary .strictEq .this (.ident "S"))) ],
      .field true "c" (some (.binary .add (.member (.ident "S") "b") (.numLit 1.0))),
      .staticBlock
        [ .varDecl .«var» [{ target := "hidden", init := some (.numLit 5.0) }],
          .exprStmt (.assign (.member (.ident "S") "d") (.ident "hidden")) ] ]

#guard outcome
    [ staticBlocks,
      .exprStmt (.logical .and
        (.logical .and
          (.logical .and
            (.logical .and
              (.binary .strictEq (.member (.ident "S") "b") (.numLit 2.0))
              (.binary .strictEq (.member (.ident "S") "c") (.numLit 3.0)))
            (.member (.ident "S") "self"))
          (.binary .strictEq (.member (.ident "S") "d") (.numLit 5.0)))
        (.binary .strictEq (.unary .typeof (.ident "hidden")) (.strLit "undefined"))) ]
  == "true"

-- `class P { static x = 7; } class Q extends P { static { Q.y = super.x; } } Q.y;`
-- — `super` inside a block reads through the constructor's parent.
#guard outcome
    [ cls "P" [ .field true "x" (some (.numLit 7.0)) ],
      subcls "Q" "P" [ .staticBlock [ .exprStmt (.assign (.member (.ident "Q") "y") (.superMember "x")) ] ],
      .exprStmt (.member (.ident "Q") "y") ]
  == "7"

-- `class T { static { throw new RangeError("boom"); } }` — a throwing block
-- escapes class evaluation.
#guard outcome [cls "T" [ .staticBlock [ .throwStmt (.new (.ident "RangeError") [.strLit "boom"]) ] ]]
  == "uncaught: RangeError: boom"

-- `let T = 0; try { T = class { static { throw new RangeError("boom"); } }; }
--  catch (e) { T = e instanceof RangeError; } T;` — a class expression whose
-- block throws leaves its target untouched.
#guard outcome
    [ .varDecl .«let» [{ target := "T", init := some (.numLit 0.0) }],
      .tryStmt
        [ .exprStmt (.assign (.ident "T") (.classExpr
            { name := none, superClass := none,
              elements := [ .staticBlock [ .throwStmt (.new (.ident "RangeError") [.strLit "boom"]) ] ] })) ]
        (some { param := some "e",
                body := [ .exprStmt (.assign (.ident "T")
                  (.binary .instanceof (.ident "e") (.ident "RangeError"))) ] })
        none,
      .exprStmt (.ident "T") ]
  == "true"

/-! ## `super.x = v` -/

/-- ```js
class A { set s(v) { this.got = v; } }
A.prototype.x = 5;
class B extends A {
  put() { super.x = 1; super.s = 2; super["y"] = 3; super.x += 10; super.x++; return this; }
}
const b = new B().put();
b.x === 6 && A.prototype.x === 5 && b.got === 2 && b.y === 3
```
The compound and update forms read `x` off the parent and write it on
the receiver, so each starts from 5 and the parent's `x` never moves. -/
private def superAssign : List Stmt :=
  [ cls "A" [ .method .setter false "s" ["v"]
      [.exprStmt (.assign (.member .this "got") (.ident "v"))] ],
    .exprStmt (.assign (.member (.member (.ident "A") "prototype") "x") (.numLit 5.0)),
    subcls "B" "A"
      [ .method .method false "put" []
          [ .exprStmt (.assign (.superMember "x") (.numLit 1.0)),
            .exprStmt (.assign (.superMember "s") (.numLit 2.0)),
            .exprStmt (.assign (.superIndex (.strLit "y")) (.numLit 3.0)),
            .exprStmt (.compoundAssign .add (.superMember "x") (.numLit 10.0)),
            .exprStmt (.update .inc false (.superMember "x")),
            .returnStmt (some .this) ] ],
    letConst "b" (.call (.member (.new (.ident "B") []) "put") []) ]

#guard outcome
    (superAssign ++
      [ .exprStmt (.logical .and
          (.logical .and
            (.logical .and
              (.binary .strictEq (.member (.ident "b") "x") (.numLit 6.0))
              (.binary .strictEq (.member (.member (.ident "A") "prototype") "x") (.numLit 5.0)))
            (.binary .strictEq (.member (.ident "b") "got") (.numLit 2.0)))
          (.binary .strictEq (.member (.ident "b") "y") (.numLit 3.0))) ])
  == "true"

-- A non-writable `x` on the parent chain refuses even though the receiver
-- would take the write:
-- `class A {} Object.defineProperty(A.prototype, "x", { value: 1, writable: false });`
-- `class B extends A { put() { super.x = 2; } } new B().put()`
#guard outcome
    [ cls "A" [],
      .exprStmt (.call (.member (.ident "Object") "defineProperty")
        [ .member (.ident "A") "prototype", .strLit "x",
          .objectLit [ .init "value" (.numLit 1.0), .init "writable" (.boolLit false) ] ]),
      subcls "B" "A" [ .method .method false "put" []
        [.exprStmt (.assign (.superMember "x") (.numLit 2.0))] ],
      .exprStmt (.call (.member (.new (.ident "B") []) "put") []) ]
  == "uncaught: TypeError: Cannot assign to read only property 'x' of object '#<Object>'"

-- A frozen receiver with no `x` anywhere refuses: the write would add a key.
-- `class A {} class B extends A { put() { Object.freeze(this); super.x = 2; } }`
-- `new B().put()`
#guard outcome
    [ cls "A" [],
      subcls "B" "A" [ .method .method false "put" []
        [ .exprStmt (.call (.member (.ident "Object") "freeze") [.this]),
          .exprStmt (.assign (.superMember "x") (.numLit 2.0)) ] ],
      .exprStmt (.call (.member (.new (.ident "B") []) "put") []) ]
  == "uncaught: TypeError: Cannot add property x, object is not extensible"

-- An own accessor on the receiver refuses, setter or not:
-- `class A {} class B extends A { put() {`
-- `  Object.defineProperty(this, "x", { set(v) {}, configurable: true });`
-- `  super.x = 1; } } new B().put()`
#guard outcome
    [ cls "A" [],
      subcls "B" "A" [ .method .method false "put" []
        [ .exprStmt (.call (.member (.ident "Object") "defineProperty")
            [ .this, .strLit "x",
              .objectLit [ .method .method "set" ["v"] [],
                           .init "configurable" (.boolLit true) ] ]),
          .exprStmt (.assign (.superMember "x") (.numLit 1.0)) ] ],
      .exprStmt (.call (.member (.new (.ident "B") []) "put") []) ]
  == "uncaught: TypeError: Cannot redefine property: x"

-- Destructuring into super members, and a static method writing to the
-- constructor:
-- `class A {} class B extends A {`
-- `  take() { [super.a, super.b] = [1, 2]; return this.a + this.b; }`
-- `  static tag() { super.t = "s"; return B.t; } }`
-- `new B().take() === 3 && B.tag() === "s"`
#guard outcome
    [ cls "A" [],
      subcls "B" "A"
        [ .method .method false "take" []
            [ .exprStmt (.assignPattern
                (.array [ some { target := .target (.superMember "a"), default := none },
                          some { target := .target (.superMember "b"), default := none } ] none)
                (.arrayLit [.numLit 1.0, .numLit 2.0])),
              .returnStmt (some (.binary .add (.member .this "a") (.member .this "b"))) ],
          .method .method true "tag" []
            [ .exprStmt (.assign (.superMember "t") (.strLit "s")),
              .returnStmt (some (.member (.ident "B") "t")) ] ],
      .exprStmt (.logical .and
        (.binary .strictEq (.call (.member (.new (.ident "B") []) "take") []) (.numLit 3.0))
        (.binary .strictEq (.call (.member (.ident "B") "tag") []) (.strLit "s"))) ]
  == "true"

-- The receiver's own properties are its real ones, so a String object's
-- read-only index refuses a super write:
-- `class S extends String { m() { try { super[0] = "z"; return "wrote"; }`
-- `  catch (e) { return e instanceof TypeError; } } } new S("ab").m()`
#guard outcome
    [ subcls "S" "String" [ .method .method false "m" []
        [ .tryStmt
            [ .exprStmt (.assign (.superIndex (.numLit 0.0)) (.strLit "z")),
              .returnStmt (some (.strLit "wrote")) ]
            (some { param := some "e",
                    body := [ .returnStmt (some (.binary .instanceof (.ident "e") (.ident "TypeError"))) ] })
            none ] ],
      .exprStmt (.call (.member (.new (.ident "S") [.strLit "ab"]) "m") []) ]
  == "true"

-- A computed super key is converted after the right-hand side runs:
-- `const log = []; const key = { toString() { log.push("key"); return "p"; } };`
-- `function rhs() { log.push("rhs"); return 1; }`
-- `class C { m() { super[key] = rhs(); } } new C().m(); log.join()`
#guard outcome
    [ letConst "log" (.arrayLit []),
      letConst "key" (.objectLit [ .method .method "toString" []
        [ .exprStmt (.call (.member (.ident "log") "push") [.strLit "key"]),
          .returnStmt (some (.strLit "p")) ] ]),
      .funcDecl "rhs" []
        [ .exprStmt (.call (.member (.ident "log") "push") [.strLit "rhs"]),
          .returnStmt (some (.numLit 1.0)) ],
      cls "C" [ .method .method false "m" []
        [.exprStmt (.assign (.superIndex (.ident "key")) (.call (.ident "rhs") []))] ],
      .exprStmt (.call (.member (.new (.ident "C") []) "m") []),
      .exprStmt (.call (.member (.ident "log") "join") []) ]
  == "rhs,key"

-- The home object's prototype is read *after* the key expression
-- (13.3.7.1: GetThisBinding, the key, then MakeSuperPropertyReference),
-- so a key that moves the prototype writes through the new one:
-- `let res; const p1 = { set p(v) { res = "p1"; } }; const p2 = { set p(v) { res = "p2"; } };`
-- `const kf = () => { Object.setPrototypeOf(o, p2); return "p"; };`
-- `const o = { __proto__: p1, m() { super[kf()] = 1; } }; o.m(); res;`
#guard outcome
    [ .varDecl .«let» [{ target := "res", init := none }],
      letConst "p1" (.objectLit [ .method .setter "p" ["v"]
        [.exprStmt (.assign (.ident "res") (.strLit "p1"))] ]),
      letConst "p2" (.objectLit [ .method .setter "p" ["v"]
        [.exprStmt (.assign (.ident "res") (.strLit "p2"))] ]),
      letConst "kf" (.arrow [] (.block
        [ .exprStmt (.call (.member (.ident "Object") "setPrototypeOf") [.ident "o", .ident "p2"]),
          .returnStmt (some (.strLit "p")) ])),
      letConst "o" (.objectLit
        [ .proto (.ident "p1"),
          .method .method "m" []
            [.exprStmt (.assign (.superIndex (.call (.ident "kf") [])) (.numLit 1.0))] ]),
      .exprStmt (.call (.member (.ident "o") "m") []),
      .exprStmt (.ident "res") ]
  == "p2"

-- The read form, same order:
-- `const p1 = { get p() { return "p1"; } }; const p2 = { get p() { return "p2"; } };`
-- `const kf = () => { Object.setPrototypeOf(o, p2); return "p"; };`
-- `const o = { __proto__: p1, m() { return super[kf()]; } }; o.m();`
#guard outcome
    [ letConst "p1" (.objectLit [ .method .getter "p" [] [.returnStmt (some (.strLit "p1"))] ]),
      letConst "p2" (.objectLit [ .method .getter "p" [] [.returnStmt (some (.strLit "p2"))] ]),
      letConst "kf" (.arrow [] (.block
        [ .exprStmt (.call (.member (.ident "Object") "setPrototypeOf") [.ident "o", .ident "p2"]),
          .returnStmt (some (.strLit "p")) ])),
      letConst "o" (.objectLit
        [ .proto (.ident "p1"),
          .method .method "m" [] [.returnStmt (some (.superIndex (.call (.ident "kf") [])))] ]),
      .exprStmt (.call (.member (.ident "o") "m") []) ]
  == "p2"

-- The call form, same order, and the callee still runs on the receiver:
-- `const p1 = { p() { return "p1"; } }; const p2 = { p() { return this === o; } };`
-- `const kf = () => { Object.setPrototypeOf(o, p2); return "p"; };`
-- `const o = { __proto__: p1, m() { return super[kf()](); } }; o.m();`
#guard outcome
    [ letConst "p1" (.objectLit [ .method .method "p" [] [.returnStmt (some (.strLit "p1"))] ]),
      letConst "p2" (.objectLit [ .method .method "p" []
        [.returnStmt (some (.binary .strictEq .this (.ident "o")))] ]),
      letConst "kf" (.arrow [] (.block
        [ .exprStmt (.call (.member (.ident "Object") "setPrototypeOf") [.ident "o", .ident "p2"]),
          .returnStmt (some (.strLit "p")) ])),
      letConst "o" (.objectLit
        [ .proto (.ident "p1"),
          .method .method "m" [] [.returnStmt (some (.call (.superIndex (.call (.ident "kf") [])) []))] ]),
      .exprStmt (.call (.member (.ident "o") "m") []) ]
  == "true"

-- But ToPropertyKey runs at the read, *after* the prototype is taken, so
-- a key whose `toString` moves the prototype still reads through the old one:
-- `const p1 = { get p() { return "p1"; } }; const p2 = { get p() { return "p2"; } };`
-- `const key = { toString() { Object.setPrototypeOf(o, p2); return "p"; } };`
-- `const o = { __proto__: p1, m() { return super[key]; } }; o.m();`
#guard outcome
    [ letConst "p1" (.objectLit [ .method .getter "p" [] [.returnStmt (some (.strLit "p1"))] ]),
      letConst "p2" (.objectLit [ .method .getter "p" [] [.returnStmt (some (.strLit "p2"))] ]),
      letConst "key" (.objectLit [ .method .method "toString" []
        [ .exprStmt (.call (.member (.ident "Object") "setPrototypeOf") [.ident "o", .ident "p2"]),
          .returnStmt (some (.strLit "p")) ] ]),
      letConst "o" (.objectLit
        [ .proto (.ident "p1"),
          .method .method "m" [] [.returnStmt (some (.superIndex (.ident "key")))] ]),
      .exprStmt (.call (.member (.ident "o") "m") []) ]
  == "p1"

/-! ## `delete super.x` -/

-- `class A {} class B extends A { m() { return delete super.x; } } new B().m()`
#guard outcome
    [ cls "A" [],
      subcls "B" "A" [ .method .method false "m" []
        [.returnStmt (some (.delete (.superMember "x")))] ],
      .exprStmt (.call (.member (.new (.ident "B") []) "m") []) ]
  == "uncaught: ReferenceError: Unsupported reference to 'super'"

-- A home object with a null prototype still throws: the base is never read.
-- `class C { static m() { delete super.x; } } Object.setPrototypeOf(C, null); C.m()`
#guard outcome
    [ cls "C" [ .method .method true "m" [] [.exprStmt (.delete (.superMember "x"))] ],
      .exprStmt (.call (.member (.ident "Object") "setPrototypeOf") [.ident "C", .nullLit]),
      .exprStmt (.call (.member (.ident "C") "m") []) ]
  == "uncaught: ReferenceError: Unsupported reference to 'super'"

-- Before `super()` the `this` read fails first.
-- `class A {} class B extends A { constructor() { delete super.x; super(); } } new B()`
#guard outcome
    [ cls "A" [],
      .classDecl "B"
        { name := some "B", superClass := some (.ident "A"),
          elements := [.ctor [] [ .exprStmt (.delete (.superMember "x")),
                                  .exprStmt (.superCall []) ]] },
      .exprStmt (.new (.ident "B") []) ]
  == ("uncaught: ReferenceError: Must call super constructor in derived class " ++
      "before accessing 'this' or returning from derived constructor")

-- The key runs but is never converted: `toString` would add "s".
-- `let log = ""; const key = {};`
-- `key.toString = function () { log += "s"; return "x"; };`
-- `function k() { log += "k"; return key; }`
-- `class A {} class B extends A { m() { delete super[k()]; } }`
-- `try { new B().m(); } catch (e) { log += e.constructor.name; } log`
#guard outcome
    [ .varDecl .«let» [{ target := "log", init := some (.strLit "") }],
      letConst "key" (.objectLit []),
      .exprStmt (.assign (.member (.ident "key") "toString")
        (.funcExpr none []
          [ .exprStmt (.compoundAssign .add (.ident "log") (.strLit "s")),
            .returnStmt (some (.strLit "x")) ])),
      .funcDecl "k" []
        [ .exprStmt (.compoundAssign .add (.ident "log") (.strLit "k")),
          .returnStmt (some (.ident "key")) ],
      cls "A" [],
      subcls "B" "A" [ .method .method false "m" []
        [.exprStmt (.delete (.superIndex (.call (.ident "k") [])))] ],
      .tryStmt [ .exprStmt (.call (.member (.new (.ident "B") []) "m") []) ]
        (some { param := some "e",
                body := [ .exprStmt (.compoundAssign .add (.ident "log")
                  (.member (.member (.ident "e") "constructor") "name")) ] })
        none,
      .exprStmt (.ident "log") ]
  == "kReferenceError"
