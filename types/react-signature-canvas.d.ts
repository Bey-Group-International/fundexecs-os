declare module 'react-signature-canvas' {
  import { Component } from 'react';

  export interface SignatureCanvasProps {
    penColor?: string;
    canvasProps?: React.CanvasHTMLAttributes<HTMLCanvasElement>;
    dotSize?: number | (() => number);
    onEnd?: () => void;
    [key: string]: unknown;
  }

  export default class SignatureCanvas extends Component<SignatureCanvasProps> {
    clear(): void;
    toDataURL(type?: string): string;
    fromDataURL(dataURL: string): void;
    isEmpty(): boolean;
  }
}
