"use strict";
class Counter {
  #n = 0;
  #bump() {
    this.#n += 1;
    return this;
  }
  get #value() {
    return this.#n;
  }
  set #value(v) {
    this.#n = v;
  }
  static #shared() {
    return 40;
  }
  static make() {
    const c = new Counter();
    c.#value = Counter.#shared();
    return c.#bump().#bump();
  }
  read() {
    return this.#value;
  }
  same(o) {
    return this.#bump === o.#bump;
  }
  static probe(o) {
    try {
      o.#bump();
      return false;
    } catch (e) {
      return e instanceof TypeError;
    }
  }
}
class Tally {
  static base = 10;
  static {
    Tally.doubled = this.base * 2;
  }
  static final = Tally.doubled + 1;
}
class Parent {
  set tagged(v) {
    this.tag = `p:${v}`;
  }
}
class Child extends Parent {
  mark() {
    super.plain = 1;
    super.tagged = 2;
    return this;
  }
}
const ch = new Child().mark();
const c = Counter.make();
c.read() === 42 &&
  c.same(new Counter()) &&
  Object.keys(c).length === 0 &&
  !("bump" in c) &&
  Counter.probe({}) &&
  Tally.doubled === 20 &&
  Tally.final === 21 &&
  ch.plain === 1 &&
  ch.tag === "p:2" &&
  !("plain" in Parent.prototype);
