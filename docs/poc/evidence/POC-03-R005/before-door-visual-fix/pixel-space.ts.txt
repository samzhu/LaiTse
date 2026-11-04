export type SpaceRoomId = "lobby" | "studio";
export type MoveDirection = "up" | "down" | "left" | "right";

export type SpacePlayer = {
  id: string;
  displayName: string;
  roomId: SpaceRoomId;
  x: number;
  y: number;
};

export type SpaceKind = "open-area" | "meeting-room";
export type AudioPolicy = "proximity" | "room";

export type SpaceRoom = {
  id: SpaceRoomId;
  name: string;
  kind: SpaceKind;
  audioPolicy: AudioPolicy;
  audioRadiusGridUnits: number | null;
  style: "sunroom" | "blueprint";
  isLocked: boolean;
  players: SpacePlayer[];
  membersVisible: boolean;
};

export type SpaceSnapshot = {
  seq: number;
  participantId: string;
  currentRoomId: SpaceRoomId;
  grid: { width: number; height: number };
  rooms: SpaceRoom[];
};

export type SpaceRenderPlayer = {
  id: string;
  displayName: string;
  roomId: SpaceRoomId;
  gridX: number;
  gridY: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  tweenActive: boolean;
  texture: string;
};

export type SpaceRenderDiagnostics = {
  ready: true;
  phaserVersion: string;
  renderer: "WebGL" | "Canvas" | "unknown";
  renderCount: number;
  renderedAt: string;
  snapshotSeq: number | null;
  players: SpaceRenderPlayer[];
  doorInput?: {
    activations: number;
    sceneEnabled: boolean;
    managerEnabled: boolean;
    pointer: { x: number; y: number };
    canvasBounds: { x: number; y: number; width: number; height: number };
    displayScale: { x: number; y: number };
    lastSceneDown: { x: number; y: number; over: string[] } | null;
  };
};

export type PixelSpaceOptions = {
  parent: HTMLElement;
  rooms: SpaceRoom[];
  snapshot: SpaceSnapshot | null;
  reducedMotion: boolean;
  onEnterRoom: (roomId: SpaceRoomId) => void;
};

export type PixelSpaceRenderer = {
  update(input: { rooms: SpaceRoom[]; snapshot: SpaceSnapshot | null; reducedMotion: boolean }): void;
  destroy(): void;
};

const CANVAS_WIDTH = 1_040;
const CANVAS_HEIGHT = 414;
const TILE_SIZE = 23;
const GRID_X = 42;
const GRID_Y = 116;
const ROOM_ORIGINS: Record<SpaceRoomId, number> = { lobby: 14, studio: 526 };
const DOOR_CENTER_X = 520;
const DOOR_TOP = 166;

type SpritePalette = { skin: string; hair: string; shirt: string; pants: string; accent: string };

const PALETTES: SpritePalette[] = [
  { skin: "#f2bd8e", hair: "#3d2c30", shirt: "#e77859", pants: "#426b87", accent: "#fff0c8" },
  { skin: "#d89469", hair: "#26364a", shirt: "#68a98c", pants: "#405969", accent: "#f9d36b" },
  { skin: "#f0c79f", hair: "#71492f", shirt: "#7185ce", pants: "#514671", accent: "#e9a78b" },
  { skin: "#b97557", hair: "#24252e", shirt: "#d5a34a", pants: "#40515e", accent: "#f3e7ca" },
  { skin: "#efbb8a", hair: "#9b5342", shirt: "#6d9bb6", pants: "#594b68", accent: "#d9edb2" },
  { skin: "#db9d76", hair: "#443544", shirt: "#b66e93", pants: "#3d6170", accent: "#e6cd83" },
  { skin: "#f0c69d", hair: "#39362e", shirt: "#58a3a0", pants: "#4e557e", accent: "#e7b478" },
  { skin: "#c98765", hair: "#302b37", shirt: "#d77a6d", pants: "#394d67", accent: "#f1d29b" },
];

function drawCharacter(context: CanvasRenderingContext2D, palette: SpritePalette): void {
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, 16, 20);
  const pixel = (x: number, y: number, w: number, h: number, color: string) => {
    context.fillStyle = color;
    context.fillRect(x, y, w, h);
  };

  // Original 16×20 pixel sprite assembled from a compact palette.
  pixel(5, 1, 6, 1, palette.hair);
  pixel(4, 2, 8, 4, palette.hair);
  pixel(4, 4, 8, 4, palette.skin);
  pixel(3, 3, 2, 4, palette.hair);
  pixel(11, 3, 2, 3, palette.hair);
  pixel(5, 5, 1, 1, "#342c32");
  pixel(10, 5, 1, 1, "#342c32");
  pixel(6, 7, 4, 1, palette.accent);
  pixel(4, 8, 8, 5, palette.shirt);
  pixel(2, 9, 2, 4, palette.skin);
  pixel(12, 9, 2, 4, palette.skin);
  pixel(4, 13, 8, 1, palette.accent);
  pixel(5, 14, 3, 4, palette.pants);
  pixel(8, 14, 3, 4, palette.pants);
  pixel(4, 18, 4, 1, "#382f3c");
  pixel(8, 18, 4, 1, "#382f3c");
}

function playerWorldPosition(player: SpacePlayer): { x: number; y: number } {
  const originX = ROOM_ORIGINS[player.roomId];
  return {
    x: originX + GRID_X + (player.x + 0.5) * TILE_SIZE,
    y: GRID_Y + (player.y + 0.5) * TILE_SIZE,
  };
}

function roomColors(style: SpaceRoom["style"]) {
  return style === "sunroom"
    ? { edge: 0xe6b987, floorA: 0xf4dfbc, floorB: 0xefd5b0, wall: 0xfff0d5, ink: "#76514b", accent: 0xd98769, furniture: 0x93aa7a }
    : { edge: 0x8db5c5, floorA: 0xc5e0df, floorB: 0xb8d8d8, wall: 0xe2f3ef, ink: "#385c74", accent: 0x598cad, furniture: 0xd69e59 };
}

export async function createPixelSpaceRenderer(
  options: PixelSpaceOptions,
  onFirstRender: (diagnostics: SpaceRenderDiagnostics) => void,
): Promise<PixelSpaceRenderer> {
  const Phaser = await import("phaser");
  let rooms = options.rooms;
  let snapshot = options.snapshot;
  let reducedMotion = options.reducedMotion;
  let sceneInstance: SpaceScene | null = null;
  let renderer: PixelSpaceRenderer | null = null;
  let firstRenderReported = false;

  class SpaceScene extends Phaser.Scene {
    private readonly roomActors = new Map<string, Phaser.GameObjects.Container>();
    private readonly roomLabels = new Map<string, Phaser.GameObjects.Text>();
    private readonly emptyLabels = new Map<SpaceRoomId, Phaser.GameObjects.Text>();
    private gameRenderCount = 0;
    private initialStateDrawn = false;
    private doorActivations = 0;
    private lastSceneDown: { x: number; y: number; over: string[] } | null = null;

    constructor() {
      super({ key: "laitse-pixel-space" });
    }

    create(): void {
      sceneInstance = this;
      this.cameras.main.setBackgroundColor("#f7f5ef");
      this.cameras.main.roundPixels = true;
      this.drawRoomZones();
      this.drawMeetingRoomDoor();
      this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        this.lastSceneDown = { x: pointer.x, y: pointer.y, over: over.map((object) => object.type) };
      });
      this.drawPlayerTextures();
      this.applySpaceState();
      this.game.events.on(Phaser.Core.Events.POST_RENDER, this.recordPostRender, this);
    }

    applySpaceState(): void {
      const activePlayers = new Map<string, SpacePlayer>();
      for (const room of rooms) {
        for (const player of room.players) activePlayers.set(player.id, player);
        const emptyLabel = this.emptyLabels.get(room.id);
        if (emptyLabel) {
          const label = !snapshot
            ? "Join to see people"
            : !room.membersVisible
              ? "Members hidden"
              : "Room is quiet";
          emptyLabel.setText(label);
          emptyLabel.setVisible(!snapshot || !room.membersVisible || room.players.length === 0);
        }
      }

      for (const [playerId, actor] of this.roomActors) {
        if (activePlayers.has(playerId)) continue;
        actor.destroy(true);
        this.roomActors.delete(playerId);
        this.roomLabels.delete(playerId);
      }

      for (const room of rooms) {
        for (const player of room.players) {
          const current = this.roomActors.get(player.id);
          const destination = playerWorldPosition(player);
          if (current) {
            const targetRoom = current.getData("roomId") as SpaceRoomId;
            const targetX = current.getData("gridX") as number;
            const targetY = current.getData("gridY") as number;
            const sameTarget = targetRoom === player.roomId && targetX === player.x && targetY === player.y;
            const roomChanged = targetRoom !== player.roomId;
            if (sameTarget && !reducedMotion) continue;
            this.tweens.killTweensOf(current);
            current.setData({ roomId: player.roomId, gridX: player.x, gridY: player.y, targetX: destination.x, targetY: destination.y });
            const label = this.roomLabels.get(player.id);
            if (reducedMotion || roomChanged) {
              current.setPosition(destination.x, destination.y);
            } else if (!sameTarget) {
              this.tweens.add({
                targets: current,
                x: destination.x,
                y: destination.y,
                duration: 110,
                ease: "Linear",
              });
            }
            label?.setText(player.displayName);
            continue;
          }

          const characterImage = this.add.image(0, 0, this.textureKey(player.id));
          characterImage.setDisplaySize(32, 40).setOrigin(0.5, 0.5);
          const label = this.add.text(0, -31, player.displayName, {
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "11px",
            fontStyle: "bold",
            color: "#26343a",
            backgroundColor: "#fffdf5",
            padding: { left: 4, right: 4, top: 2, bottom: 2 },
          }).setOrigin(0.5, 0.5);
          const actor = this.add.container(destination.x, destination.y, [characterImage, label]);
          actor.setDepth(10).setData({
            roomId: player.roomId,
            gridX: player.x,
            gridY: player.y,
            targetX: destination.x,
            targetY: destination.y,
            displayName: player.displayName,
          });
          this.roomActors.set(player.id, actor);
          this.roomLabels.set(player.id, label);
        }
      }
      this.initialStateDrawn = true;
    }

    private drawRoomZones(): void {
      const graphics = this.add.graphics();
      for (const room of rooms) {
        const originX = ROOM_ORIGINS[room.id];
        const colors = roomColors(room.style);
        graphics.fillStyle(colors.wall, 1).fillRoundedRect(originX, 16, 498, 380, 24);
        graphics.lineStyle(2, colors.edge, 1).strokeRoundedRect(originX, 16, 498, 380, 24);
        graphics.fillStyle(colors.accent, 1).fillRoundedRect(originX + 22, 31, 58, 6, 3);
        this.add.text(originX + 22, 48, room.name, {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "18px",
          fontStyle: "bold",
          color: colors.ink,
        });
        this.drawGrid(graphics, originX, colors);
        this.drawFurniture(graphics, originX, colors, room.id);
        const empty = this.add.text(originX + 250, 92, "Room is quiet", {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "11px",
          color: colors.ink,
          backgroundColor: "#ffffff99",
          padding: { left: 5, right: 5, top: 3, bottom: 3 },
        }).setOrigin(0.5, 0.5);
        this.emptyLabels.set(room.id, empty);
      }
    }

    private drawMeetingRoomDoor(): void {
      const locked = rooms.find((room) => room.id === "studio")?.isLocked ?? false;
      const frame = this.add.graphics();
      frame.fillStyle(0x56453a, 1).fillRoundedRect(DOOR_CENTER_X - 15, DOOR_TOP, 30, 78, 5);
      frame.fillStyle(locked ? 0x8c5b55 : 0x71916e, 1).fillRoundedRect(DOOR_CENTER_X - 10, DOOR_TOP + 5, 20, 68, 3);
      frame.lineStyle(2, 0xf4e5c4, 1).strokeRoundedRect(DOOR_CENTER_X - 10, DOOR_TOP + 5, 20, 68, 3);
      frame.fillStyle(0xe9d1a3, 1).fillCircle(DOOR_CENTER_X + 5, DOOR_TOP + 40, 2);
      frame.fillStyle(0xb68c57, 1).fillRect(DOOR_CENTER_X - 18, DOOR_TOP + 74, 36, 4);
      this.add.text(DOOR_CENTER_X, DOOR_TOP - 12, locked ? "LOCKED" : "OPEN", {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "8px",
        fontStyle: "bold",
        color: locked ? "#874e47" : "#557452",
        backgroundColor: "#fffdf5",
        padding: { left: 4, right: 4, top: 2, bottom: 2 },
      }).setOrigin(0.5, 0.5);

      this.add.zone(DOOR_CENTER_X, DOOR_TOP + 39, 38, 82)
        .setInteractive({ cursor: "pointer" })
        .on(Phaser.Input.Events.POINTER_DOWN, () => {
          this.doorActivations += 1;
          const currentRoomId = snapshot?.currentRoomId;
          options.onEnterRoom(currentRoomId === "studio" ? "lobby" : "studio");
        });
    }

    private drawGrid(graphics: Phaser.GameObjects.Graphics, originX: number, colors: ReturnType<typeof roomColors>): void {
      const x = originX + GRID_X;
      const y = GRID_Y;
      const gridWidth = 16 * TILE_SIZE;
      const gridHeight = 10 * TILE_SIZE;
      graphics.fillStyle(colors.edge, 1).fillRoundedRect(x - 5, y - 5, gridWidth + 10, gridHeight + 10, 10);
      for (let tileY = 0; tileY < 10; tileY += 1) {
        for (let tileX = 0; tileX < 16; tileX += 1) {
          const color = (tileX + tileY) % 2 === 0 ? colors.floorA : colors.floorB;
          graphics.fillStyle(color, 1).fillRect(x + tileX * TILE_SIZE, y + tileY * TILE_SIZE, TILE_SIZE - 1, TILE_SIZE - 1);
        }
      }
    }

    private drawFurniture(graphics: Phaser.GameObjects.Graphics, originX: number, colors: ReturnType<typeof roomColors>, roomId: SpaceRoomId): void {
      const x = originX + GRID_X;
      if (roomId === "lobby") {
        graphics.fillStyle(0x91aa74, 1).fillRoundedRect(x + 23, GRID_Y + 29, 45, 19, 6);
        graphics.fillStyle(0x6b805c, 1).fillRect(x + 30, GRID_Y + 45, 5, 8);
        graphics.fillStyle(0x6b805c, 1).fillRect(x + 55, GRID_Y + 45, 5, 8);
        graphics.fillStyle(0xd59670, 1).fillRoundedRect(x + 260, GRID_Y + 158, 73, 36, 10);
        graphics.fillStyle(0x7894a2, 1).fillRoundedRect(x + 132, GRID_Y + 33, 28, 28, 14);
        graphics.fillStyle(0xf4c46a, 1).fillCircle(x + 146, GRID_Y + 47, 7);
      } else {
        graphics.fillStyle(0x7aaab5, 1).fillRoundedRect(x + 250, GRID_Y + 28, 79, 50, 7);
        graphics.fillStyle(0xe4f2e7, 1).fillRoundedRect(x + 255, GRID_Y + 33, 69, 40, 5);
        graphics.lineStyle(2, colors.accent, 1).lineBetween(x + 289, GRID_Y + 34, x + 289, GRID_Y + 73);
        graphics.lineStyle(2, colors.accent, 1).lineBetween(x + 256, GRID_Y + 53, x + 323, GRID_Y + 53);
        graphics.fillStyle(colors.furniture, 1).fillRoundedRect(x + 46, GRID_Y + 155, 99, 42, 8);
        graphics.fillStyle(0x6c7d8b, 1).fillRoundedRect(x + 57, GRID_Y + 148, 77, 14, 6);
        graphics.fillStyle(0x7c9d78, 1).fillRoundedRect(x + 339, GRID_Y + 155, 32, 38, 8);
      }
    }

    private drawPlayerTextures(): void {
      for (const [index, palette] of PALETTES.entries()) {
        const texture = this.textures.createCanvas(`t07-avatar-${index}`, 16, 20);
        if (!texture) continue;
        drawCharacter(texture.context, palette);
        texture.refresh();
      }
    }

    private textureKey(playerId: string): string {
      let hash = 0;
      for (const character of playerId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
      return `t07-avatar-${hash % PALETTES.length}`;
    }

    private recordPostRender(): void {
      this.gameRenderCount += 1;
      if (!this.initialStateDrawn) return;
      const rendererType = this.game.renderer?.type;
      const rendererName = rendererType === Phaser.WEBGL ? "WebGL" : rendererType === Phaser.CANVAS ? "Canvas" : "unknown";
      const players: SpaceRenderPlayer[] = [...this.roomActors.entries()].map(([id, actor]) => ({
        id,
        displayName: String(actor.getData("displayName") ?? ""),
        roomId: actor.getData("roomId") as SpaceRoomId,
        gridX: actor.getData("gridX") as number,
        gridY: actor.getData("gridY") as number,
        x: actor.x,
        y: actor.y,
        targetX: Number(actor.getData("targetX")),
        targetY: Number(actor.getData("targetY")),
        tweenActive: this.tweens.getTweensOf(actor).some((tween) => tween.isPlaying()),
        texture: String((actor.getAt(0) as Phaser.GameObjects.Image).texture?.key ?? "unknown"),
      }));
      const diagnostics: SpaceRenderDiagnostics = {
        ready: true,
        phaserVersion: Phaser.VERSION,
        renderer: rendererName,
        renderCount: this.gameRenderCount,
        renderedAt: new Date().toISOString(),
        snapshotSeq: snapshot?.seq ?? null,
        players,
        doorInput: {
          activations: this.doorActivations,
          sceneEnabled: this.input.enabled,
          managerEnabled: this.game.input.enabled,
          pointer: { x: this.input.activePointer.x, y: this.input.activePointer.y },
          canvasBounds: { x: this.scale.canvasBounds.x, y: this.scale.canvasBounds.y, width: this.scale.canvasBounds.width, height: this.scale.canvasBounds.height },
          displayScale: { x: this.scale.displayScale.x, y: this.scale.displayScale.y },
          lastSceneDown: this.lastSceneDown,
        },
      };
      const canvas = this.game.canvas;
      canvas?.setAttribute("data-testid", "t07-phaser-canvas");
      canvas?.setAttribute("data-phaser-version", Phaser.VERSION);
      canvas?.setAttribute("data-renderer", rendererName);
      options.parent.dataset.renderReady = "true";
      options.parent.dataset.renderedPhaserState = JSON.stringify(diagnostics);
      Object.assign(window, { __t07SpaceRender: diagnostics });
      if (!firstRenderReported) {
        firstRenderReported = true;
        onFirstRender(diagnostics);
      }
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    parent: options.parent,
    backgroundColor: "#f7f5ef",
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    audio: { noAudio: true },
    input: { keyboard: false, mouse: true, touch: true },
    banner: false,
    scene: [SpaceScene],
  });

  // React can move the canvas without a window resize. Refresh the coordinate
  // transform before Phaser receives a mouse/touch down at the new position.
  const syncPointerBounds = () => {
    if (!game.canvas) return;
    game.scale.updateBounds();
    const bounds = game.scale.canvasBounds;
    if (bounds.width > 0 && bounds.height > 0) {
      game.scale.displayScale.set(game.scale.baseSize.width / bounds.width, game.scale.baseSize.height / bounds.height);
    }
  };
  const pointerBoundaryEvents = ["pointerdown", "mousedown", "touchstart"] as const;
  for (const name of pointerBoundaryEvents) {
    options.parent.addEventListener(name, syncPointerBounds, { capture: true, passive: true });
  }

  renderer = {
    update(input) {
      rooms = input.rooms;
      snapshot = input.snapshot;
      reducedMotion = input.reducedMotion;
      sceneInstance?.applySpaceState();
    },
    destroy() {
      for (const name of pointerBoundaryEvents) options.parent.removeEventListener(name, syncPointerBounds, true);
      sceneInstance = null;
      game.destroy(true);
      delete options.parent.dataset.renderReady;
      delete options.parent.dataset.renderedPhaserState;
      const target = window as Window & { __t07SpaceRender?: SpaceRenderDiagnostics };
      if (target.__t07SpaceRender?.ready) delete target.__t07SpaceRender;
    },
  };
  return renderer;
}
