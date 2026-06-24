import type { DetailedHTMLProps, HTMLAttributes } from "react";

type LdrsProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  size?: string | number;
  speed?: string | number;
  stroke?: string | number;
  color?: string;
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "l-chaotic-orbit": LdrsProps;
      "l-cardio": LdrsProps;
    }
  }
}

// React 19 resolves intrinsic elements via the React.JSX namespace, so augment it too.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "l-chaotic-orbit": LdrsProps;
      "l-cardio": LdrsProps;
    }
  }
}
