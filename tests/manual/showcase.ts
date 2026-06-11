// A live showcase of everything the engine can do TODAY (pure PDF, standard-14 fonts,
// no ZUGFeRD). Factored into a builder so both the manual runner and a verify script can
// render the exact same document. Pass real image paths in.
import { PDFDocumentElement } from "../../src/lib/elements/pdf-document-element";
import { PageElement, PDFPageConfig } from "../../src/lib/elements/page-element";
import { ContainerElement } from "../../src/lib/elements/container-element";
import { RectangleElement } from "../../src/lib/elements/rectangle-element";
import { LineElement } from "../../src/lib/elements/line-element";
import {
  BoxFit,
  CustomLocalImage,
  ExpandedElement,
  ImageElement,
  PaddingElement,
} from "../../src/lib/elements";
import { TextElement, TextSegment } from "../../src/lib/elements/text-element";
import { HorizontalAlignment, PDFElement } from "../../src/lib/elements/pdf-element";
import { FontStyle } from "../../src/lib/utils/pdf-object-manager";
import { Color } from "../../src/lib/common/color";
import { PageSize } from "../../src/lib/constants/page-sizes";
import { Orientation } from "../../src/lib/renderer/pdf-config";

export interface ShowcaseAssets {
  photo: string; // a .jpg/.jpeg
  logo: string; // a .png (transparency is composited over white)
}

// --- palette ---
const ink = new Color(33, 37, 41);
const muted = new Color(130, 137, 150);
const brand = new Color(20, 90, 170);
const accent = new Color(190, 50, 50);
const green = new Color(30, 130, 90);
const paper = new Color(247, 249, 252);

// --- tiny builder helpers ---
interface TextOpts {
  size?: number;
  family?: string;
  style?: FontStyle;
  color?: Color;
  align?: HorizontalAlignment;
}
const t = (content: string | TextSegment[], o: TextOpts = {}): TextElement =>
  new TextElement({
    content,
    fontSize: o.size ?? 11,
    fontFamily: o.family ?? "Helvetica",
    fontStyle: o.style ?? FontStyle.Normal,
    color: o.color ?? ink,
    textAlignment: o.align ?? HorizontalAlignment.left,
  });

const block = (child: PDFElement, marginBottom = 12): PaddingElement =>
  new PaddingElement({ margin: [0, 0, marginBottom, 0], child });

const divider = (color = muted, marginBottom = 12): PaddingElement =>
  new PaddingElement({
    margin: [0, 0, marginBottom, 0],
    child: new LineElement({ x: 0, y: 0, xEnd: 0, yEnd: 0, strokeWidth: 0.8, color }),
  });

// A note/callout box that shrink-wraps its text and shows a border (+ optional fill).
const note = (
  content: string,
  o: { border?: Color; bg?: Color; color?: Color; size?: number } = {}
): RectangleElement =>
  new RectangleElement({
    x: 0,
    y: 0,
    borderWidth: 1,
    color: o.border ?? brand,
    backgroundColor: o.bg,
    children: [
      new PaddingElement({
        margin: [10, 12, 10, 12],
        child: t(content, { size: o.size ?? 11, color: o.color ?? ink }),
      }),
    ],
  });

const flexGap = (): ExpandedElement =>
  new ExpandedElement({ flex: 1, child: t("") });

const page = (children: PDFElement[], config?: PDFPageConfig): PageElement =>
  new PageElement({
    config: config ?? {
      pageSize: PageSize.A4,
      orientation: Orientation.portrait,
    },
    children: [new ContainerElement({ x: 0, y: 0, children })],
  });

const LOREM =
  "JasyPDF lays this text out with the real Adobe AFM font metrics of the standard-14 " +
  "fonts, so word wrapping and kerning are computed, not guessed. The right edge stays " +
  "tight because each glyph advances by its true width. Umlaute work too: Muenchen, " +
  "Groesse, aeoeue, Fuesse. ";

export function makeShowcase(assets: ShowcaseAssets): PDFDocumentElement {
  // ---------- Page 1: a letter ----------
  const letter = page([
    block(t("ASD · Software & Design", { size: 9, color: muted }), 18),
    block(t("JasyPDF", { size: 32, style: FontStyle.Bold, color: brand }), 2),
    block(
      t("Declarative, component-based PDF generation in pure TypeScript", {
        size: 12,
        color: muted,
      })
    ),
    divider(brand),
    block(
      t("Freilassing, 11. Juni 2026", {
        size: 10,
        color: muted,
        align: HorizontalAlignment.right,
      })
    ),
    block(t("Sehr geehrte Leserin, sehr geehrter Leser,", { size: 11.5 })),
    block(t(LOREM, { family: "Times-Roman", size: 11.5 })),
    block(t(LOREM, { family: "Times-Roman", size: 11.5 })),
    note(
      "Diese Notiz-Box schrumpft auf ihren Inhalt, zeigt einen Rahmen und bricht bei " +
        "Bedarf sauber über Seiten um.",
      { border: brand, bg: paper }
    ),
    flexGap(), // pushes the closing + footer to the bottom of the page
    block(t("Mit freundlichen Gruessen", { size: 11.5 }), 2),
    block(t("Florian Heuberger", { size: 11.5, style: FontStyle.Bold })),
    divider(muted, 4),
    t("JasyPDF · pure-TS PDF engine · Seite 1", {
      size: 8,
      color: muted,
      align: HorizontalAlignment.center,
    }),
  ]);

  // ---------- Page 2: typography & components ----------
  const typography = page([
    block(t("Typografie & Komponenten", { size: 22, style: FontStyle.Bold, color: ink }), 4),
    divider(),
    block(t("Schriftfamilien (Standard-14):", { size: 10, color: muted }), 6),
    block(t("Helvetica — the quick brown fox 1234567890", { family: "Helvetica" }), 4),
    block(t("Times-Roman — the quick brown fox 1234567890", { family: "Times-Roman" }), 4),
    block(t("Courier — the quick brown fox 1234567890", { family: "Courier" }), 14),

    block(t("Schnitte:", { size: 10, color: muted }), 6),
    block(t("Normal", { style: FontStyle.Normal }), 3),
    block(t("Bold", { style: FontStyle.Bold }), 3),
    block(t("Italic", { style: FontStyle.Italic }), 3),
    block(t("Bold Italic", { style: FontStyle.BoldItalic }), 14),

    block(t("Ausrichtung:", { size: 10, color: muted }), 6),
    block(t("links ausgerichtet", { align: HorizontalAlignment.left }), 3),
    block(t("zentriert", { align: HorizontalAlignment.center }), 3),
    block(t("rechtsbündig", { align: HorizontalAlignment.right }), 14),

    block(t("Inline gemischte Segmente (Font, Größe, Farbe in einer Zeile):", { size: 10, color: muted }), 6),
    block(
      t([
        { content: "Rechnung ", fontStyle: FontStyle.Bold, fontSize: 16, fontColor: ink },
        { content: "bezahlt ", fontStyle: FontStyle.Italic, fontSize: 12, fontColor: green },
        { content: "— Betrag ", fontSize: 12, fontColor: ink },
        { content: "1.234,56 €", fontStyle: FontStyle.Bold, fontSize: 12, fontColor: accent },
        { content: " (inkl. MwSt). Der Rest dieses Absatzes bricht ganz normal über die volle Breite um und zeigt, dass gemischte Segmente und Umbruch zusammenspielen.", fontSize: 11, fontColor: ink },
      ], { family: "Helvetica" })
    , 14),

    block(note("Info-Box (blau, gefüllt).", { border: brand, bg: paper }), 8),
    block(note("Erfolg-Box (grün, ohne Füllung).", { border: green }), 8),
    note("Achtung-Box (rot, gefüllt).", { border: accent, bg: new Color(252, 244, 244) }),
  ]);

  // ---------- Page 3: images ----------
  const images = page([
    block(t("Bilder", { size: 22, style: FontStyle.Bold, color: ink }), 4),
    divider(),
    block(t("JPEG, eingepasst (contain):", { size: 10, color: muted }), 6),
    block(
      new ImageElement({
        image: new CustomLocalImage(assets.photo),
        height: 230,
        fit: BoxFit.contain,
      })
    ),
    block(t("PNG mit Transparenz (über Weiß kompositiert), contain:", { size: 10, color: muted }), 6),
    block(
      new ImageElement({
        image: new CustomLocalImage(assets.logo),
        height: 200,
        fit: BoxFit.contain,
      })
    ),
    note(
      "Bilder bewegen sich beim Seitenumbruch als Ganzes (atomar). Text um ein Bild " +
        "herum (float) gibt es noch nicht — siehe Roadmap.",
      { border: muted }
    ),
  ]);

  // ---------- Page 4: an invitation (A5 landscape, centered) ----------
  const invitation = page(
    [
      flexGap(),
      block(t("E I N L A D U N G", { size: 26, style: FontStyle.Bold, color: brand, align: HorizontalAlignment.center }), 6),
      divider(brand, 10),
      block(t("Wir feiern das erste echte PDF aus JasyPDF", { size: 13, family: "Times-Roman", color: ink, align: HorizontalAlignment.center }), 16),
      block(t("Freitag, 11. Juni 2026 · 19:00 Uhr", { size: 12, color: ink, align: HorizontalAlignment.center }), 4),
      block(t("Freilassing", { size: 12, color: muted, align: HorizontalAlignment.center }), 16),
      divider(brand, 10),
      flexGap(),
    ],
    { pageSize: PageSize.A5, orientation: Orientation.landscape }
  );

  // ---------- Page 5: multi-page flow ----------
  const flow = page([
    block(t("Mehrseitiger Textfluss", { size: 22, style: FontStyle.Bold, color: ink }), 4),
    divider(),
    block(note("Der folgende Artikel ist länger als eine Seite und fließt automatisch weiter.", { border: brand, bg: paper })),
    block(t("Ein langer Artikel", { size: 14, style: FontStyle.Bold }), 6),
    t(LOREM.repeat(22), { family: "Times-Roman", size: 11.5 }),
  ]);

  return new PDFDocumentElement({
    children: [letter, typography, images, invitation, flow],
  });
}
