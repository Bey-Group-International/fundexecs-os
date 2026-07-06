"use client";

import { type CSSProperties, type ReactNode } from "react";
import { toPlainText, type TextComponent } from "@/lib/richtext";

// React renderer for the framework-agnostic rich-text model in lib/richtext.ts,
// inspired by Kyori/PaperMC Adventure. It plays the role of an Adventure
// "serializer": it walks the immutable TextComponent tree and emits the platform's
// native representation — here, nested <span>s with inline styles. All styling and
// event semantics live in the model; this file only translates them to the DOM.
//
// Gradients are already expanded into per-character children in the model, so the
// renderer needs no gradient logic — it just walks children and colors each span.

/** Build the inline style for a single component node from its style fields. */
function styleFor(component: TextComponent): CSSProperties {
  const style: CSSProperties = {};
  if (component.color) style.color = component.color;
  if (component.bold) style.fontWeight = 700;
  if (component.italic) style.fontStyle = "italic";
  const decorations: string[] = [];
  if (component.underlined) decorations.push("underline");
  if (component.strikethrough) decorations.push("line-through");
  if (decorations.length > 0) style.textDecoration = decorations.join(" ");
  return style;
}

/** Recursively render a component's own text plus its children. */
function renderNode(component: TextComponent, key?: number): ReactNode {
  const children = component.children ?? [];
  const inner: ReactNode = (
    <>
      {component.text}
      {children.map((child, i) => renderNode(child, i))}
    </>
  );

  const style = styleFor(component);
  const title = component.hover;
  const click = component.click;

  if (click?.action === "open_url") {
    return (
      <a
        key={key}
        href={click.value}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        style={style}
      >
        {inner}
      </a>
    );
  }

  // "run" clicks are rendered inline via the top-level component (which has access
  // to onRun). Nested run-clicks fall back to a titled span so the tree still
  // renders; wire onRun at the node you care about by making it the root.
  return (
    <span key={key} title={title} style={style}>
      {inner}
    </span>
  );
}

/**
 * Render a {@link TextComponent} tree to nested spans/anchors/buttons.
 *
 * - color/bold/italic/underline/strikethrough → inline styles
 * - hover → native `title` tooltip
 * - click.action "open_url" → an external `<a>`
 * - click.action "run" → a `<button>` invoking {@link onRun} with the click value
 */
export function RichText({
  component,
  className,
  onRun,
}: {
  component: TextComponent;
  className?: string;
  onRun?: (value: string) => void;
}) {
  const style = styleFor(component);
  const title = component.hover;
  const click = component.click;
  const children = component.children ?? [];
  const inner: ReactNode = (
    <>
      {component.text}
      {children.map((child, i) => renderNode(child, i))}
    </>
  );

  if (click?.action === "run") {
    return (
      <button
        type="button"
        className={className}
        title={title}
        style={style}
        aria-label={toPlainText(component)}
        onClick={() => onRun?.(click.value)}
      >
        {inner}
      </button>
    );
  }

  if (click?.action === "open_url") {
    return (
      <a
        className={className}
        href={click.value}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        style={style}
      >
        {inner}
      </a>
    );
  }

  return (
    <span className={className} title={title} style={style}>
      {inner}
    </span>
  );
}
