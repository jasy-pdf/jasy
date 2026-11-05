import { describe, it, expect, vi } from "vitest";
import { Image } from "../../../src/lib/api/content";
import {
  ImageElement,
  CustomLocalImage,
  CustomImage,
  BoxFit,
} from "../../../src/lib/elements/image-element";
import { pngFile } from "../support/image-file.ts";

const props = (i: ImageElement) => i.getProps();

describe("Image factory", () => {
  it("wraps a string path in a CustomLocalImage", () => {
    const i = Image(pngFile());
    expect(i).toBeInstanceOf(ImageElement);
    expect(props(i).image).toBeInstanceOf(CustomLocalImage);
  });

  it("passes a ready CustomImage straight through", () => {
    const custom = new CustomLocalImage(pngFile()) as CustomImage;
    expect(props(Image(custom)).image).toBe(custom);
  });

  it("maps fit names to BoxFit and defaults to fill, as CSS object-fit", () => {
    expect(props(Image(pngFile())).fit).toBe(BoxFit.fill);
    expect(props(Image(pngFile(), { fit: "none" })).fit).toBe(BoxFit.none);
    expect(props(Image(pngFile(), { fit: "cover" })).fit).toBe(BoxFit.cover);
    expect(props(Image(pngFile(), { fit: "contain" })).fit).toBe(BoxFit.contain);
  });

  it("passes width / height / radius through", () => {
    const i = Image(pngFile(), { width: 80, height: 60, radius: 8 });
    expect(props(i).width).toBe(80);
    expect(props(i).height).toBe(60);
    expect(props(i).radius).toBe(8);
  });
});

describe("the async pass before layout", () => {
  it("fetches only what layout cannot read itself: a file or bytes in hand is left alone", async () => {
    const image = Image(pngFile()) as ImageElement;
    const init = vi.spyOn(props(image).image, "init");
    await image.resolveIntrinsicSize();
    expect(init).not.toHaveBeenCalled();
  });
});
