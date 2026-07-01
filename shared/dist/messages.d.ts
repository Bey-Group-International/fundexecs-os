import { z } from "zod";
export declare const FacingSchema: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
export type Facing = z.infer<typeof FacingSchema>;
export declare const RemotePlayerSchema: z.ZodObject<{
    id: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
    name: z.ZodString;
    spriteKey: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    name: string;
    spriteKey: string;
}, {
    id: string;
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    name: string;
    spriteKey: string;
}>;
export type RemotePlayer = z.infer<typeof RemotePlayerSchema>;
export declare const WORLD_W = 1152;
export declare const WORLD_H = 864;
export declare const SPAWN_X = 192;
export declare const SPAWN_Y = 144;
export declare const PlayerMoveSchema: z.ZodObject<{
    type: z.ZodLiteral<"player.move">;
    dx: z.ZodNumber;
    dy: z.ZodNumber;
    seq: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "player.move";
    dx: number;
    dy: number;
    seq: number;
}, {
    type: "player.move";
    dx: number;
    dy: number;
    seq: number;
}>;
export type PlayerMove = z.infer<typeof PlayerMoveSchema>;
export declare const PingSchema: z.ZodObject<{
    type: z.ZodLiteral<"ping">;
    clientTime: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "ping";
    clientTime: number;
}, {
    type: "ping";
    clientTime: number;
}>;
export type Ping = z.infer<typeof PingSchema>;
export declare const ClientMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"player.move">;
    dx: z.ZodNumber;
    dy: z.ZodNumber;
    seq: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "player.move";
    dx: number;
    dy: number;
    seq: number;
}, {
    type: "player.move";
    dx: number;
    dy: number;
    seq: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"ping">;
    clientTime: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "ping";
    clientTime: number;
}, {
    type: "ping";
    clientTime: number;
}>]>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export declare const WorldSnapshotSchema: z.ZodObject<{
    type: z.ZodLiteral<"world.snapshot">;
    players: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
        name: z.ZodString;
        spriteKey: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "world.snapshot";
    players: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }[];
}, {
    type: "world.snapshot";
    players: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }[];
}>;
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;
export declare const WelcomeSchema: z.ZodObject<{
    type: z.ZodLiteral<"welcome">;
    playerId: z.ZodString;
    worldSnapshot: z.ZodObject<{
        type: z.ZodLiteral<"world.snapshot">;
        players: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            x: z.ZodNumber;
            y: z.ZodNumber;
            facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
            name: z.ZodString;
            spriteKey: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }, {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    }, {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    }>;
}, "strip", z.ZodTypeAny, {
    type: "welcome";
    playerId: string;
    worldSnapshot: {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    };
}, {
    type: "welcome";
    playerId: string;
    worldSnapshot: {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    };
}>;
export type Welcome = z.infer<typeof WelcomeSchema>;
export declare const PlayerJoinedSchema: z.ZodObject<{
    type: z.ZodLiteral<"player.joined">;
    player: z.ZodObject<{
        id: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
        name: z.ZodString;
        spriteKey: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "player.joined";
    player: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    };
}, {
    type: "player.joined";
    player: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    };
}>;
export type PlayerJoined = z.infer<typeof PlayerJoinedSchema>;
export declare const PlayerLeftSchema: z.ZodObject<{
    type: z.ZodLiteral<"player.left">;
    playerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "player.left";
    playerId: string;
}, {
    type: "player.left";
    playerId: string;
}>;
export type PlayerLeft = z.infer<typeof PlayerLeftSchema>;
export declare const PlayerStateSchema: z.ZodObject<{
    type: z.ZodLiteral<"player.state">;
    playerId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
    seq: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "player.state";
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    seq: number;
    playerId: string;
}, {
    type: "player.state";
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    seq: number;
    playerId: string;
}>;
export type PlayerState = z.infer<typeof PlayerStateSchema>;
export declare const PongSchema: z.ZodObject<{
    type: z.ZodLiteral<"pong">;
    clientTime: z.ZodNumber;
    serverTime: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "pong";
    clientTime: number;
    serverTime: number;
}, {
    type: "pong";
    clientTime: number;
    serverTime: number;
}>;
export type Pong = z.infer<typeof PongSchema>;
export declare const ServerMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"welcome">;
    playerId: z.ZodString;
    worldSnapshot: z.ZodObject<{
        type: z.ZodLiteral<"world.snapshot">;
        players: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            x: z.ZodNumber;
            y: z.ZodNumber;
            facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
            name: z.ZodString;
            spriteKey: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }, {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    }, {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    }>;
}, "strip", z.ZodTypeAny, {
    type: "welcome";
    playerId: string;
    worldSnapshot: {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    };
}, {
    type: "welcome";
    playerId: string;
    worldSnapshot: {
        type: "world.snapshot";
        players: {
            id: string;
            x: number;
            y: number;
            facing: "down" | "up" | "left" | "right" | "idle";
            name: string;
            spriteKey: string;
        }[];
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"player.joined">;
    player: z.ZodObject<{
        id: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
        name: z.ZodString;
        spriteKey: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "player.joined";
    player: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    };
}, {
    type: "player.joined";
    player: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"player.left">;
    playerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "player.left";
    playerId: string;
}, {
    type: "player.left";
    playerId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"player.state">;
    playerId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
    seq: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "player.state";
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    seq: number;
    playerId: string;
}, {
    type: "player.state";
    x: number;
    y: number;
    facing: "down" | "up" | "left" | "right" | "idle";
    seq: number;
    playerId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"world.snapshot">;
    players: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        facing: z.ZodEnum<["down", "up", "left", "right", "idle"]>;
        name: z.ZodString;
        spriteKey: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }, {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "world.snapshot";
    players: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }[];
}, {
    type: "world.snapshot";
    players: {
        id: string;
        x: number;
        y: number;
        facing: "down" | "up" | "left" | "right" | "idle";
        name: string;
        spriteKey: string;
    }[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"pong">;
    clientTime: z.ZodNumber;
    serverTime: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "pong";
    clientTime: number;
    serverTime: number;
}, {
    type: "pong";
    clientTime: number;
    serverTime: number;
}>]>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
//# sourceMappingURL=messages.d.ts.map