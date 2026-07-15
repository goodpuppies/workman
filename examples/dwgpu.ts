import {
  Canvas,
  EventType,
  Window,
  WindowBuilder,
  PixelFormat,
  TextureAccess,
  Rect,
} from "jsr:@divy/sdl2";
import { PNG } from "npm:pngjs";

class SimpleRenderer {
  device: GPUDevice;
  canvas: Canvas;
  window: Window;
  renderBuffer: GPUBuffer;
  frameCount: number = 0;

  constructor(device: GPUDevice) {
    this.device = device;
    const window = new WindowBuilder("Simple Renderer", 800, 600).build();
    this.window = window;
    this.canvas = window.canvas();
    console.log("SimpleRenderer constructed");

    // Create a buffer to render into
    this.renderBuffer = this.device.createBuffer({
      size: 800 * 600 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
  }

  async init() {
    console.log("Initializing SimpleRenderer");
    // No texture creation needed
  }

  render() {
    console.log("Rendering frame", this.frameCount);

    try {
      const bindGroupLayout = this.device.createBindGroupLayout({
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" }
        }]
      });

      const pipeline = this.device.createComputePipeline({
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: [bindGroupLayout]
        }),
        compute: {
          module: this.device.createShaderModule({
            code: `
              @group(0) @binding(0) var<storage, read_write> output: array<u32>;

              @compute @workgroup_size(16, 16)
              fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
                let index = global_id.y * 800u + global_id.x;
                if (index < 800u * 600u) {
                  output[index] = 0xFF00FF00u;  // ABGR: Opaque Green
                }
              }
            `
          }),
          entryPoint: "main"
        }
      });

      const bindGroup = this.device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{
          binding: 0,
          resource: { buffer: this.renderBuffer }
        }]
      });

      const commandEncoder = this.device.createCommandEncoder();
      const computePass = commandEncoder.beginComputePass();
      computePass.setPipeline(pipeline);
      computePass.setBindGroup(0, bindGroup);
      computePass.dispatchWorkgroups(Math.ceil(800 / 16), Math.ceil(600 / 16));
      computePass.end();

      this.device.queue.submit([commandEncoder.finish()]);
      console.log("Render pass completed");
    } catch (error) {
      console.error("Error during rendering:", error);
      throw error;
    }

    this.frameCount++;
  }

  async update() {
    console.log("Updating frame", this.frameCount);

    try {
      this.render();

      const stagingBuffer = this.device.createBuffer({
        size: 800 * 600 * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });

      const commandEncoder = this.device.createCommandEncoder();
      commandEncoder.copyBufferToBuffer(
        this.renderBuffer, 0,
        stagingBuffer, 0,
        800 * 600 * 4
      );
      this.device.queue.submit([commandEncoder.finish()]);

      await stagingBuffer.mapAsync(GPUMapMode.READ);
      const arrayBuffer = stagingBuffer.getMappedRange();
      const data = new Uint8Array(arrayBuffer);

      console.log("Buffer data summary:");
      console.log("Total bytes:", data.length);
      console.log("Non-zero bytes:", data.filter(byte => byte !== 0).length);
      console.log("First non-zero byte index:", data.findIndex(byte => byte !== 0));

      await this.saveRenderedImage(data, 800, 600);

      const sdlTexture = this.canvas.textureCreator().createTexture(
        PixelFormat.ABGR8888,
        TextureAccess.Streaming,
        800,
        600,
      );
      sdlTexture.update(data, 800 * 4);

      this.canvas.clear();
      const srcRect = new Rect(0, 0, 800, 600);
      const dstRect = new Rect(0, 0, 800, 600);
      this.canvas.copy(sdlTexture, srcRect, dstRect);
      this.canvas.present();

      stagingBuffer.unmap();
      console.log("Frame updated successfully");
    } catch (error) {
      console.error("Error during update:", error);
    }
  }

  async saveRenderedImage(data: Uint8Array, width: number, height: number) {
    console.log("Saving rendered image");
    console.log("Data length:", data.length);
    console.log("Expected length:", width * height * 4);

    console.log("First few pixels of data:");
    for (let i = 0; i < 20; i += 4) {
      console.log(`Pixel ${i / 4}: R=${data[i]}, G=${data[i + 1]}, B=${data[i + 2]}, A=${data[i + 3]}`);
    }

    const png = new PNG({ width, height });
    png.data.set(data);

    const pngBuffer = PNG.sync.write(png);
    //await Deno.writeFile(`rendered_image_${this.frameCount}.png`, pngBuffer);
    console.log(`Rendered image saved as rendered_image_${this.frameCount}.png`);
  }
}

async function getDevice(): Promise<GPUDevice> {
  console.log("Requesting WebGPU adapter");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("No appropriate GPUAdapter found");
  }

  console.log("Requesting WebGPU device");
  const device = await adapter.requestDevice({
    requiredFeatures: [],
    requiredLimits: {},
  });
  console.log("WebGPU device created");
  return device;
}

async function loop(renderer: SimpleRenderer) {
  console.log("Entering main loop");
  while (true) {
    try {
      const event = await renderer.window.events().next();

      if (event.done) {
        console.log("Event stream closed");
        break;
      }

      console.log("Received event:", event.value.type);

      switch (event.value.type) {
        case EventType.Draw:
          console.log("Draw event received");
          await renderer.update();
          break;
        case EventType.Quit:
          console.log("Quit event received");
          return;
        case EventType.KeyDown:
          console.log("KeyDown event received");
          // Handle key events here
          break;
        case EventType.MouseMotion:
          // Uncomment if you want to see these frequent events
          // console.log("Mouse motion event received");
          break;
        default:
          console.log("Unhandled event type:", event.value.type);
          break;
      }
    } catch (error) {
      console.error("Error in event loop:", error);
      if (error instanceof DOMException && error.name === "AbortError") {
        console.log("Event stream aborted");
        break;
      }
    }
  }
  console.log("Exiting main loop");
}


console.log("Starting application");
let renderer: SimpleRenderer;

try {
  const device = await getDevice();
  renderer = new SimpleRenderer(device);
  await renderer.init();

  await loop(renderer);

  console.log("Application finished normally");
} catch (error) {
  console.error("Fatal error:", error);
} finally {
  console.log("Cleaning up...");
  // Perform any necessary cleanup here
  Deno.exit(0);
}