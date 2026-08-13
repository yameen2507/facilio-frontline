/**
 * Types for `<fc-icon>`, the custom element from `@facilio/icons`.
 *
 * The package ships no usable types: its `package.json` advertises
 * `types: dist/types/index.d.ts`, but the published tarball contains only
 * `dist/bundle.js`. So the element is declared here, or `strict` rejects it as an
 * unknown intrinsic element.
 *
 * `name` is required and `group` effectively is too — a wrong value fetches a URL
 * that 403s and the component renders nothing, with no error a user would see.
 * That is why Icon.tsx keeps the pairs in one checked map rather than letting call
 * sites pass strings.
 */

import type { HTMLAttributes } from "react";

type FcIconAttributes = HTMLAttributes<HTMLElement> & {
  /** Icon group. Only "default" and "action" are known to exist. */
  group?: string;
  /** File name without `.svg`, resolved as `<baseURL>/<group>/<name>.svg`. */
  name: string;
  /** Pixel size as a bare number — it is interpolated into `${size}px`. */
  size?: string;
  /** Any CSS colour. Injected as `fill:` on the fetched SVG's root element. */
  color?: string;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "fc-icon": FcIconAttributes;
    }
  }
}
