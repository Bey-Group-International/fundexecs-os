import { detectInstallPlatform, installGuide, isStandaloneDisplay } from "./install-platform";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15",
  // WKWebView inside Instagram / LinkedIn / Mail: no `Safari/` token at all.
  iphoneInApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0",
  iphoneMailWebView:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  ipadSafariMobileUA:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  // iPadOS default: asks for the desktop site and claims to be a Mac.
  ipadSafariDesktopUA:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macSafari17:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macSafari18:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  macSafari16:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  macEdge:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:126.0) Gecko/20100101 Firefox/126.0",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
};

describe("detectInstallPlatform", () => {
  it("names Safari on iPhone", () => {
    expect(detectInstallPlatform({ userAgent: UA.iphoneSafari })).toBe("ios-safari");
  });

  it("separates other iOS browsers, which have their own Share menus", () => {
    expect(detectInstallPlatform({ userAgent: UA.iphoneChrome })).toBe("ios-other-browser");
    expect(detectInstallPlatform({ userAgent: UA.iphoneFirefox })).toBe("ios-other-browser");
  });

  it("flags in-app web views, where Add to Home Screen does not exist", () => {
    expect(detectInstallPlatform({ userAgent: UA.iphoneInApp })).toBe("ios-in-app");
    expect(detectInstallPlatform({ userAgent: UA.iphoneMailWebView })).toBe("ios-in-app");
  });

  it("names Safari on iPad from the mobile user agent", () => {
    expect(detectInstallPlatform({ userAgent: UA.ipadSafariMobileUA, maxTouchPoints: 5 })).toBe("ipados-safari");
  });

  it("tells an iPad asking for the desktop site apart from a Mac by its touch points", () => {
    expect(detectInstallPlatform({ userAgent: UA.ipadSafariDesktopUA, maxTouchPoints: 5 })).toBe("ipados-safari");
    expect(detectInstallPlatform({ userAgent: UA.ipadSafariDesktopUA, maxTouchPoints: 0 })).toBe("macos-safari");
    expect(detectInstallPlatform({ userAgent: UA.ipadSafariDesktopUA })).toBe("macos-safari");
  });

  it("names Safari 17+ on a Mac, where Add to Dock exists", () => {
    expect(detectInstallPlatform({ userAgent: UA.macSafari17 })).toBe("macos-safari");
    expect(detectInstallPlatform({ userAgent: UA.macSafari18 })).toBe("macos-safari");
  });

  it("names older Mac Safari as legacy", () => {
    expect(detectInstallPlatform({ userAgent: UA.macSafari16 })).toBe("macos-safari-legacy");
  });

  it("does not mistake Chromium or Firefox for Safari just because the UA says Safari", () => {
    expect(detectInstallPlatform({ userAgent: UA.macChrome })).toBe("other");
    expect(detectInstallPlatform({ userAgent: UA.macEdge })).toBe("other");
    expect(detectInstallPlatform({ userAgent: UA.macFirefox })).toBe("other");
    expect(detectInstallPlatform({ userAgent: UA.windowsChrome })).toBe("other");
    expect(detectInstallPlatform({ userAgent: UA.androidChrome })).toBe("other");
  });

  it("treats an empty user agent as other", () => {
    expect(detectInstallPlatform({ userAgent: "" })).toBe("other");
  });
});

describe("installGuide", () => {
  it("has steps for every Safari path and none for Chromium", () => {
    for (const p of ["ios-safari", "ipados-safari", "ios-other-browser", "ios-in-app", "macos-safari", "macos-safari-legacy"] as const) {
      const g = installGuide(p);
      expect(g).not.toBeNull();
      expect(g!.platform).toBe(p);
      expect(g!.steps.length).toBeGreaterThanOrEqual(2);
      expect(g!.title).toBeTruthy();
      expect(g!.cta).toBeTruthy();
    }
    expect(installGuide("other")).toBeNull();
  });

  it("starts the iPhone path at the Share button and ends on the Home Screen", () => {
    const g = installGuide("ios-safari")!;
    expect(g.steps[0].glyph).toBe("share");
    expect(g.steps[0].title).toMatch(/Share/);
    expect(g.steps[1].title).toMatch(/Add to Home Screen/);
  });

  it("sends in-app browsers to Safari first", () => {
    const g = installGuide("ios-in-app")!;
    expect(g.steps[0].title).toMatch(/Safari/);
  });

  it("points Mac Safari at File › Add to Dock", () => {
    const g = installGuide("macos-safari")!;
    expect(g.steps[0].title).toMatch(/Add to Dock/);
  });
});

describe("isStandaloneDisplay", () => {
  it("reads the display-mode media query", () => {
    expect(isStandaloneDisplay({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(isStandaloneDisplay({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });

  it("falls back to iOS Safari's navigator.standalone", () => {
    expect(isStandaloneDisplay({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } })).toBe(true);
    expect(isStandaloneDisplay({ navigator: { standalone: true } })).toBe(true);
  });

  it("is false with neither signal, and survives a throwing matchMedia", () => {
    expect(isStandaloneDisplay({})).toBe(false);
    expect(
      isStandaloneDisplay({
        matchMedia: () => {
          throw new Error("no media");
        },
      }),
    ).toBe(false);
  });
});
