import { BoxFit, ImageElement } from "../elements/image-element.ts";
import { bytesFromLatin1 } from "../utils/bytes.ts";
import {
  applyContainFit,
  applyCoverFit,
  applyFillFit,
  applyFitNone,
  decodePngToRgbFlate,
} from "../utils/image-helper.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { IRNode, Image } from "../ir/display-list.ts";

export class ImageRenderer {
  static async render(
    imageElement: ImageElement,
    objectManager: PDFObjectManager,
  ): Promise<IRNode[]> {
    // Load the image and convert it in a binary string
    let { x, y, width, height, image, fit, radius, alt } = imageElement.getProps();
    await image.init(); // Load and initialize the image
    const imageType = await image.getImageType(); // For the moment we can handle `png` and `jpg/jpeg` files
    const fileData = await image.getFileData();
    const dimensions = await image.getImageDimensions();

    if (!fileData) {
      throw new Error("File data cannot be `null`");
    }

    // JPEG embeds raw (PDF decodes DCTDecode natively). PNG is not a valid Flate stream,
    // so decode it to raw DeviceRGB samples that the FlateDecode XObject path expects.
    let embedData = fileData;
    let smask: string | undefined;
    if (imageType === "FlateDecode") {
      const decoded = await decodePngToRgbFlate(bytesFromLatin1(fileData));
      embedData = decoded.data;
      smask = decoded.smask;
    }

    // Now we check the `fit` property and changing the dimensions of the image
    // Optionally we must add an overflow container
    let mustCreateOverflowContainer: boolean = false;
    const containerDimensions = JSON.parse(JSON.stringify({ x, y, width, height })); // Deep clone images dimensions
    switch (fit) {
      case BoxFit.cover:
        mustCreateOverflowContainer = true;
        const fitCoverResult = applyCoverFit(
          dimensions.width,
          dimensions.height,
          width ?? 0,
          height ?? 0,
        );
        x += fitCoverResult.offsetX;
        y += fitCoverResult.offsetY;
        width = fitCoverResult.width;
        height = fitCoverResult.height;
        break;
      case BoxFit.contain:
        mustCreateOverflowContainer = true;
        const fitContainResult = applyContainFit(
          dimensions.width,
          dimensions.height,
          width ?? 0,
          height ?? 0,
        );
        x += fitContainResult.offsetX;
        y += fitContainResult.offsetY;
        width = fitContainResult.width;
        height = fitContainResult.height;
        break;
      case BoxFit.none:
        const fitNoneResult = applyFitNone(
          dimensions.width,
          dimensions.height,
          width ?? 0,
          height ?? 0,
        );
        x += fitNoneResult.offsetX;
        y += fitNoneResult.offsetY;
        width = fitNoneResult.width;
        height = fitNoneResult.height;
        break;
      case BoxFit.fill:
        const fitFillResult = applyFillFit(width ?? 0, height ?? 0);
        width = fitFillResult.width;
        height = fitFillResult.height;
    }

    // A radius rounds the image BOX (the element frame), so it clips to that frame too -
    // independent of the cover/contain overflow clip.
    const wantsClip = mustCreateOverflowContainer || (radius ?? 0) > 0;

    // The fitted geometry becomes a display-list primitive; the backend registers
    // the XObject and emits the placement (+ clip, rounded when a radius is set).
    const node: Image = {
      type: "image",
      x,
      y,
      width: width!,
      height: height!,
      intrinsicWidth: dimensions.width,
      intrinsicHeight: dimensions.height,
      data: embedData,
      imageType,
      ...(smask ? { smask } : {}),
      ...(radius ? { radius } : {}),
      ...(wantsClip
        ? {
            clip: {
              x: containerDimensions.x,
              y: containerDimensions.y,
              width: containerDimensions.width,
              height: containerDimensions.height,
            },
          }
        : {}),
    };

    // Accessible tagging: an image WITH alt text is a Figure; without, it stays untagged and the backend
    // treats it as decoration (an Artifact). One struct element per image.
    if (objectManager.struct.enabled && alt) {
      node.tag = {
        role: "Figure",
        key: objectManager.struct.openElement(imageElement.structId, "Figure", { alt }),
      };
    }

    return [node];
  }
}
