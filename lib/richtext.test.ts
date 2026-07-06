// lib/richtext.test.ts
// Unit tests for the Adventure-inspired rich-text model + builder. These pin down
// the three guarantees a renderer depends on: the fluent builder produces the exact
// TextComponent shape, gradients expand into one distinctly-colored child per
// character (linear RGB interpolation), and toPlainText flattens a nested tree.
import {
  applyGradient,
  empty,
  join,
  text,
  toPlainText,
  type TextComponent,
} from "@/lib/richtext";

describe("text builder", () => {
  it("produces the expected TextComponent with styles and events", () => {
    const component = text("Hello")
      .color("#ff0000")
      .bold()
      .italic()
      .underlined()
      .strikethrough()
      .hover("a tooltip")
      .clickUrl("https://example.com")
      .build();

    expect(component).toEqual({
      text: "Hello",
      color: "#ff0000",
      bold: true,
      italic: true,
      underlined: true,
      strikethrough: true,
      hover: "a tooltip",
      click: { action: "open_url", value: "https://example.com" },
    });
  });

  it("omits unset decorations rather than emitting false", () => {
    const component = text("plain").build();
    expect(component).toEqual({ text: "plain" });
    expect(component).not.toHaveProperty("bold");
    expect(component).not.toHaveProperty("color");
  });

  it("records a run click with its opaque value", () => {
    const component = text("do it").clickRun("action-42").build();
    expect(component.click).toEqual({ action: "run", value: "action-42" });
  });

  it("appends builders and raw components as children", () => {
    const component = text("root")
      .append(text("child-a").color("#00ff00"), { text: "child-b" })
      .build();
    expect(component.children).toEqual([
      { text: "child-a", color: "#00ff00" },
      { text: "child-b" },
    ]);
  });
});

describe("applyGradient", () => {
  it("splits a string into one child per character", () => {
    const children = applyGradient("abcd", ["#000000", "#ffffff"]);
    expect(children).toHaveLength(4);
    expect(children.map((c) => c.text)).toEqual(["a", "b", "c", "d"]);
  });

  it("interpolates distinct colors across the stops, endpoints exact", () => {
    const children = applyGradient("abcd", ["#000000", "#ffffff"]);
    const colors = children.map((c) => c.color);
    expect(colors[0]).toBe("#000000");
    expect(colors[colors.length - 1]).toBe("#ffffff");
    // Every character gets a distinct interpolated color along a black→white ramp.
    expect(new Set(colors).size).toBe(children.length);
  });

  it("colors a single character with the first stop", () => {
    expect(applyGradient("x", ["#123456", "#abcdef"])).toEqual([
      { text: "x", color: "#123456" },
    ]);
  });

  it("returns no children for an empty string", () => {
    expect(applyGradient("", ["#000000", "#ffffff"])).toEqual([]);
  });
});

describe("builder .gradient()", () => {
  it("expands into per-character children and clears own text", () => {
    const component = text("abc").gradient(["#000000", "#ffffff"]).build();
    expect(component.text).toBe("");
    expect(component.gradient).toEqual(["#000000", "#ffffff"]);
    expect(component.children).toHaveLength(3);
    expect(component.children?.map((c) => c.text).join("")).toBe("abc");
  });
});

describe("toPlainText", () => {
  it("concatenates nested text depth-first", () => {
    const tree: TextComponent = {
      text: "a",
      children: [
        { text: "b", children: [{ text: "c" }] },
        { text: "d" },
      ],
    };
    expect(toPlainText(tree)).toBe("abcd");
  });

  it("flattens a gradient component back to its source string", () => {
    const component = text("hello").gradient(["#ff0000", "#0000ff"]).build();
    expect(toPlainText(component)).toBe("hello");
  });
});

describe("empty and join", () => {
  it("empty() is a blank text node", () => {
    expect(empty()).toEqual({ text: "" });
  });

  it("join() interleaves a separator between parts", () => {
    const joined = join(", ", text("a"), text("b"), text("c"));
    expect(toPlainText(joined)).toBe("a, b, c");
    expect(joined.children).toHaveLength(5);
  });
});
