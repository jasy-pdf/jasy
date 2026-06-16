import { describe, it, expect } from "vitest";
import { Image } from "../../../src/lib/api/content";
import {
  ImageElement,
  CustomLocalImage,
  CustomImage,
  BoxFit,
} from "../../../src/lib/elements/image-element";

const props = (i: ImageElement) => i.getProps();

describe("Image factory", () => {
  it("wraps a string path in a CustomLocalImage", () => {
    const i = Image("/tmp/x.png");
    expect(i).toBeInstanceOf(ImageElement);
    expect(props(i).image).toBeInstanceOf(CustomLocalImage);
  });

  it("passes a ready CustomImage straight through", () => {
    const custom = new CustomLocalImage("/tmp/y.png") as CustomImage;
    expect(props(Image(custom)).image).toBe(custom);
  });

  it("maps fit names to BoxFit and defaults to none", () => {
    expect(props(Image("a.png")).fit).toBe(BoxFit.none);
    expect(props(Image("a.png", { fit: "cover" })).fit).toBe(BoxFit.cover);
    expect(props(Image("a.png", { fit: "contain" })).fit).toBe(BoxFit.contain);
  });

  it("passes width / height / radius through", () => {
    const i = Image("a.png", { width: 80, height: 60, radius: 8 });
    expect(props(i).width).toBe(80);
    expect(props(i).height).toBe(60);
    expect(props(i).radius).toBe(8);
  });
});
