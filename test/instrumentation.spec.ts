import { describe, expect, it, vi } from "vitest";
import { installInstrumentation } from "../src/shared/instrumentation/instrument.js";

function createFakeLocator() {
  return {
    boundingBox: vi.fn(async () => ({ x: 10, y: 20, width: 30, height: 40 })),
    click: vi.fn(async () => {}),
    dblclick: vi.fn(async () => {}),
    hover: vi.fn(async () => {}),
    fill: vi.fn(async () => {}),
    type: vi.fn(async () => {}),
    press: vi.fn(async () => {}),
    check: vi.fn(async () => {}),
    uncheck: vi.fn(async () => {}),
    selectOption: vi.fn(async () => {}),
    focus: vi.fn(async () => {}),
    locator: vi.fn(),
    getByRole: vi.fn(),
    getByText: vi.fn(),
    getByLabel: vi.fn(),
    getByPlaceholder: vi.fn(),
    getByAltText: vi.fn(),
    getByTitle: vi.fn(),
    getByTestId: vi.fn(),
    filter: vi.fn(),
    and: vi.fn(),
    or: vi.fn(),
    first: vi.fn(),
    last: vi.fn(),
    nth: vi.fn(),
    contentFrame: vi.fn(),
  };
}

function createFakeFrameLocator() {
  return {
    locator: vi.fn(),
    getByRole: vi.fn(),
    getByText: vi.fn(),
    getByLabel: vi.fn(),
    getByPlaceholder: vi.fn(),
    getByAltText: vi.fn(),
    getByTitle: vi.fn(),
    getByTestId: vi.fn(),
    owner: vi.fn(),
    frameLocator: vi.fn(),
    first: vi.fn(),
    last: vi.fn(),
    nth: vi.fn(),
  };
}

function createFakePage(args: {
  locatorResult: ReturnType<typeof createFakeLocator>;
  frameLocatorResult: ReturnType<typeof createFakeFrameLocator>;
}) {
  return {
    locator: vi.fn((_: string) => args.locatorResult),
    frameLocator: vi.fn((_: string) => args.frameLocatorResult),
    addInitScript: vi.fn(async () => {}),
    evaluate: vi.fn(async () => null),
    waitForTimeout: vi.fn(async () => {}),
    url: vi.fn(() => "https://example.com"),
  };
}

describe("installInstrumentation", () => {
  it("instruments locators returned through locator.contentFrame chains", async () => {
    const iframeLocator = createFakeLocator();
    const frameLocator = createFakeFrameLocator();
    const submitButton = createFakeLocator();
    const originalClick = submitButton.click;
    frameLocator.getByRole.mockReturnValue(submitButton);
    iframeLocator.contentFrame.mockReturnValue(frameLocator);

    const page = createFakePage({
      locatorResult: iframeLocator,
      frameLocatorResult: createFakeFrameLocator(),
    });

    await installInstrumentation(page as never, { visualize: false });

    const button = page
      .locator('iframe[name="newBody"]')
      .contentFrame()
      .getByRole("button", { name: "Submit" });

    expect(button.click).not.toBe(originalClick);

    await button.click();

    expect(originalClick).toHaveBeenCalledTimes(1);
  });

  it("instruments locators returned through page.frameLocator chains", async () => {
    const frameLocator = createFakeFrameLocator();
    const submitButton = createFakeLocator();
    const originalClick = submitButton.click;
    frameLocator.getByRole.mockReturnValue(submitButton);

    const page = createFakePage({
      locatorResult: createFakeLocator(),
      frameLocatorResult: frameLocator,
    });

    await installInstrumentation(page as never, { visualize: false });

    const button = page
      .frameLocator('iframe[name="newBody"]')
      .getByRole("button", { name: "Submit" });

    expect(button.click).not.toBe(originalClick);

    await button.click();

    expect(originalClick).toHaveBeenCalledTimes(1);
  });
});
