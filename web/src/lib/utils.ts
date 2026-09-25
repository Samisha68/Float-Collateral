import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/* tailwind-merge has to be told about Float's type scale.

   DESIGN.md replaced Tailwind's font sizes with nine named steps (micro,
   caption, meta, body, lead, stat, title, display, figure). tailwind-merge
   does not know them, so it read `text-micro` as a *colour* and treated it as
   conflicting with `text-primary-foreground` — dropping the colour and
   keeping the size, because the size came last.

   The symptom was a solid black badge with black text on it: invisible, and
   invisible in a way no type check or build can see. It survived because
   nothing had combined a custom size with an explicit colour until the
   profile page did.

   Naming the scale here fixes every such pairing at once rather than making
   each call site work around it. */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "micro", "caption", "meta", "body", "lead",
            "stat", "title", "display", "figure",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
