import os from "node:os";
import path from "node:path";

export function getFontPath(fontName: string) {
  const platform = os.platform();
  let fontPath = "";

  if (platform === "win32") {
    fontPath = path.join("C:\\Windows\\Fonts", fontName);
  } else if (platform === "darwin") {
    fontPath = path.join("/Library/Fonts", fontName);
  } else if (platform === "linux") {
    fontPath = path.join("/usr/share/fonts", fontName);
  }

  return fontPath;
}
