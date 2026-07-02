declare module 'phaser' {
  namespace Phaser {
    class Game {
      events: any;
      scene: any;
      canvas: any;
      constructor(config?: any);
      destroy(removeCanvas: boolean): void;
    }
    const AUTO: number;
    namespace Scale {
      const FIT: any;
      const CENTER_BOTH: any;
    }
    namespace GameObjects {
      type GameObject = any;
      type Sprite = any;
      type Text = any;
      type Image = any;
      type Graphics = any;
      type Container = any;
      type Group = any;
      type TileSprite = any;
      type Zone = any;
      type Arc = any;
    }
    namespace Physics {
      const Arcade: any;
      namespace Arcade {
        type Sprite = any;
        type StaticGroup = any;
        type Group = any;
        type Body = any;
        type StaticBody = any;
      }
    }
    namespace Input {
      namespace Keyboard {
        type Key = any;
        type CursorKeys = any;
        const KeyCodes: any;
        function addKey(keyCode: any): any;
        function createCursorKeys(): any;
      }
    }
    namespace Types {
      namespace Core {
        type GameConfig = any;
      }
      namespace Physics {
        namespace Arcade {
          type ArcadePhysicsCallback = any;
        }
      }
      namespace Input {
        namespace Keyboard {
          type CursorKeys = any;
        }
      }
    }
    namespace Geom {
      class Rectangle {
        constructor(x?: number, y?: number, width?: number, height?: number);
        static Contains(rect: Rectangle, x: number, y: number): boolean;
        [key: string]: any;
      }
      class Circle { constructor(x?: number, y?: number, radius?: number); [key: string]: any; }
      class Point { constructor(x?: number, y?: number); [key: string]: any; }
    }
    namespace Math {
      function Between(min: number, max: number): number;
      function Clamp(value: number, min: number, max: number): number;
      function Linear(p0: number, p1: number, t: number): number;
      namespace Distance {
        function Between(x1: number, y1: number, x2: number, y2: number): number;
      }
      const Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => number };
    }
    namespace Display {
      namespace Color {
        function IntegerToColor(color: number): any;
        function HSVColorWheel(s?: number, v?: number): any[];
      }
    }
    class Scene {
      game: any;
      load: any;
      physics: any;
      add: any;
      anims: any;
      textures: any;
      cameras: any;
      input: any;
      sound: any;
      time: any;
      events: any;
      sys: any;
      constructor(config?: any);
      preload(): void;
      create(): void;
      update(time: number, delta: number): void;
    }
  }
  export = Phaser;
}
