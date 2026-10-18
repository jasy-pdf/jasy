import type { RenderScope } from "../utils/renderer-registry.ts";
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
import { IRNode, Image, isRounded } from "../ir/display-list.ts";

export class ImageRenderer {
  static async render(
    imageElement: ImageElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    // Load the image and convert it in a binary string
    const {
      x: ownX,
      y: ownY,
      width,
      height,
      image,
      fit,
      radius,
      align,
      alt,
    } = imageElement.getProps();
    // Its own position is relative to `scope.origin`; the IR wants page coordinates.
    const x = scope.origin.x + (ownX ?? 0);
    const y = scope.origin.y + (ownY ?? 0);
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

    // The box laid out for it; `fit` decides what is drawn in it and where.
    const box = {
      x,
      y,
      width: width ?? dimensions.width,
      height: height ?? dimensions.height,
    };
    const fitted =
      fit === BoxFit.cover
        ? applyCoverFit(dimensions.width, dimensions.height, box.width, box.height, align)
        : fit === BoxFit.contain
          ? applyContainFit(dimensions.width, dimensions.height, box.width, box.height, align)
          : fit === BoxFit.none
            ? applyFitNone(dimensions.width, dimensions.height, box.width, box.height, align)
            : applyFillFit(box.width, box.height);

    // Anything but `fill` may leave the box, so it is clipped to it; a radius rounds the box too.
    const wantsClip = fit !== BoxFit.fill || isRounded(radius);

    // The fitted geometry becomes a display-list primitive; the backend registers
    // the XObject and emits the placement (+ clip, rounded when a radius is set).
    const node: Image = {
      type: "image",
      x: x + fitted.offsetX,
      y: y + fitted.offsetY,
      width: fitted.width,
      height: fitted.height,
      intrinsicWidth: dimensions.width,
      intrinsicHeight: dimensions.height,
      data: embedData,
      imageType,
      ...(smask ? { smask } : {}),
      ...(radius ? { radius } : {}),
      ...(wantsClip ? { clip: box } : {}),
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
