import { add, fmt } from "./base.js";

const $ = (id) => document.getElementById(id);

/* ---------------- RUN / CADENCE ---------------- */

let runActive = false;
let runStartedAt = 0;
let runTimerId = null;
let stepTimes = [];
let lastStepAt = 0;
let cadenceLast = null;
let hrLast = null;

const AGE_KEY = "gymSensorAge";
let userAge = null;

function getAge() {
  const v = Number($("ageInput")?.value);
  return Number.isFinite(v) && v >= 15 && v <= 90 ? v : null;
}

function zoneInfo(age) {
  if (!age) return null;

  const maxHr = 220 - age;
  const moderateLow = Math.round(maxHr * 0.50);
  const moderateHigh = Math.round(maxHr * 0.70);
  const vigorousLow = Math.round(maxHr * 0.70);
  const vigorousHigh = Math.round(maxHr * 0.85);

  return {
    maxHr,
    moderateLow,
    moderateHigh,
    vigorousLow,
    vigorousHigh
  };
}

function updateHeartRateGuide(bpm = hrLast) {
  const age = getAge();
  const label = $("zoneLabel");
  const text = $("zoneText");
  const ranges = $("zoneRanges");

  if (!label || !text || !ranges) return;

  if (!age) {
    label.textContent = "AGE REQUIRED";
    text.textContent =
      "나이를 입력하면 예상 최대심박수와 운동 강도 구간을 계산합니다.";
    ranges.textContent = "";
    return;
  }

  userAge = age;
  localStorage.setItem(AGE_KEY, String(age));

  const z = zoneInfo(age);

  ranges.innerHTML =
    "예상 최대심박수 " +
    z.maxHr +
    " bpm<br>중강도 " +
    z.moderateLow +
    "–" +
    z.moderateHigh +
    " bpm · 고강도 " +
    z.vigorousLow +
    "–" +
    z.vigorousHigh +
    " bpm";

  if (!Number.isFinite(bpm)) {
    label.textContent = "TARGET READY";
    text.textContent =
      "체중관리 목적의 지속 가능한 유산소는 중강도 구간을 기본 참고 범위로 사용할 수 있습니다.";
    return;
  }

  const hr = Math.round(bpm);

  if (hr < z.moderateLow) {
    label.textContent = "REST / LOW";
    text.textContent =
      hr +
      " bpm · 현재는 중강도 운동 구간보다 낮습니다. 휴식 중 측정값이라면 자연스러울 수 있습니다.";
  } else if (hr < z.vigorousLow) {
    label.textContent = "MODERATE";
    text.textContent =
      hr +
      " bpm · 지속 가능한 유산소 강도 구간입니다. 체중관리용 러닝의 기본 참고 구간으로 사용할 수 있습니다.";
  } else if (hr <= z.vigorousHigh) {
    label.textContent = "VIGOROUS";
    text.textContent =
      hr +
      " bpm · 높은 운동 강도 구간입니다. 같은 시간을 운동하면 부담이 더 커질 수 있습니다.";
  } else {
    label.textContent = "VERY HIGH";
    text.textContent =
      hr +
      " bpm · 예상 최대심박수의 85%를 넘는 높은 강도입니다. 측정 오류 여부와 운동 강도를 함께 확인하세요.";
  }
}


async function requestMotionPermission() {
  if (
    typeof DeviceMotionEvent !== "undefined" &&
    typeof DeviceMotionEvent.requestPermission === "function"
  ) {
    const result = await DeviceMotionEvent.requestPermission();
    if (result !== "granted") {
      throw new Error("모션 센서 권한이 필요합니다.");
    }
  }
}

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || [a.x, a.y, a.z].some((x) => typeof x !== "number")) return;

  const magnitude = Math.hypot(a.x, a.y, a.z);
  const now = performance.now();

  if (magnitude > 11 && now - lastStepAt > 250) {
    lastStepAt = now;
    stepTimes.push(now);
    stepTimes = stepTimes.filter((x) => now - x < 15000);

    if (stepTimes.length > 3) {
      const intervals = [];
      for (let i = 1; i < stepTimes.length; i++) {
        intervals.push(stepTimes[i] - stepTimes[i - 1]);
      }

      intervals.sort((a, b) => a - b);
      const trimmed =
        intervals.length > 4 ? intervals.slice(1, -1) : intervals;

      const avg =
        trimmed.reduce((a, b) => a + b, 0) / Math.max(1, trimmed.length);

      const spm = 60000 / avg;

      if (spm > 60 && spm < 240) {
        cadenceLast = spm;
        $("cadence").textContent = Math.round(spm);
      }
    }
  }
}

const savedAge = localStorage.getItem(AGE_KEY);
if (savedAge && $("ageInput")) {
  $("ageInput").value = savedAge;
  userAge = Number(savedAge);
}
if ($("ageInput")) {
  $("ageInput").addEventListener("input", () => updateHeartRateGuide(hrLast));
}
updateHeartRateGuide();

$("runStart").onclick = async () => {
  try {
    await requestMotionPermission();

    runActive = true;
    runStartedAt = performance.now();
    stepTimes = [];
    cadenceLast = null;

    window.addEventListener("devicemotion", onMotion);

    runTimerId = setInterval(() => {
      $("timer").textContent = fmt(
        (performance.now() - runStartedAt) / 1000
      );
    }, 250);

    $("runState").textContent = "RUNNING";
    $("runStart").disabled = true;
    $("runStop").disabled = false;
  } catch (e) {
    alert(e.message);
  }
};

$("runStop").onclick = () => {
  if (!runActive) return;

  const duration = (performance.now() - runStartedAt) / 1000;

  runActive = false;
  clearInterval(runTimerId);
  window.removeEventListener("devicemotion", onMotion);

  $("runState").textContent = "SAVED";
  $("runStart").disabled = false;
  $("runStop").disabled = true;

  add({
    type: "run",
    duration,
    cadence: cadenceLast,
    hr: hrLast
  });
};

/* ---------------- CAMERA PPG HEART RATE ---------------- */

let hrStream = null;
let hrTrack = null;
let hrActive = false;
let hrSamples = [];
let hrStartedAt = 0;
let hrRaf = null;
let torchEnabled = false;
let lastFingerSeenAt = 0;
let stableEstimates = [];

const hrVideo = $("hrVideo");
const hrCanvas = $("hrCanvas");
const hrCtx = hrCanvas.getContext("2d", { willReadFrequently: true });

function stopTorch() {
  if (!hrTrack || !torchEnabled) return;

  try {
    hrTrack.applyConstraints({
      advanced: [{ torch: false }]
    });
  } catch {}

  torchEnabled = false;
}

async function tryEnableTorch(track) {
  try {
    const caps = track.getCapabilities?.();

    if (!caps || !caps.torch) {
      return false;
    }

    await track.applyConstraints({
      advanced: [{ torch: true }]
    });

    return true;
  } catch (err) {
    console.warn("Torch unavailable:", err);
    return false;
  }
}

function resample(samples, fs = 30) {
  if (samples.length < 2) return [];

  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  const duration = (t1 - t0) / 1000;

  if (duration <= 0) return [];

  const n = Math.floor(duration * fs);
  const out = new Array(n);

  let j = 0;

  for (let i = 0; i < n; i++) {
    const target = t0 + (i * 1000) / fs;

    while (
      j + 1 < samples.length &&
      samples[j + 1].t < target
    ) {
      j++;
    }

    const a = samples[j];
    const b = samples[Math.min(j + 1, samples.length - 1)];

    const dt = b.t - a.t;
    const w = dt > 0 ? (target - a.t) / dt : 0;

    out[i] = a.v + (b.v - a.v) * Math.max(0, Math.min(1, w));
  }

  return out;
}

function detrend(values, fs = 30) {
  const n = values.length;
  if (!n) return [];

  const radius = Math.max(1, Math.round(fs * 0.6));
  const prefix = new Array(n + 1).fill(0);

  for (let i = 0; i < n; i++) {
    prefix[i + 1] = prefix[i] + values[i];
  }

  const out = new Array(n);

  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n, i + radius + 1);

    const mean =
      (prefix[hi] - prefix[lo]) / Math.max(1, hi - lo);

    out[i] = values[i] - mean;
  }

  // light 3-point smoothing
  return out.map((_, i) => {
    let sum = 0;
    let count = 0;

    for (let k = Math.max(0, i - 1); k <= Math.min(n - 1, i + 1); k++) {
      sum += out[k];
      count++;
    }

    return sum / count;
  });
}

function estimateHeartRate() {
  if (hrSamples.length < 120) return null;

  const recent = hrSamples.slice(-600);
  const duration =
    (recent[recent.length - 1].t - recent[0].t) / 1000;

  if (duration < 7) return null;

  const fs = 30;
  const uniform = resample(recent, fs);

  if (uniform.length < fs * 7) return null;

  const signal = detrend(uniform, fs);
  const mean =
    signal.reduce((a, b) => a + b, 0) / signal.length;

  const centered = signal.map((v) => v - mean);

  const energy =
    centered.reduce((a, b) => a + b * b, 0) /
    Math.max(1, centered.length);

  if (energy < 0.000001) return null;

  const minBpm = 45;
  const maxBpm = 200;

  const minLag = Math.floor((fs * 60) / maxBpm);
  const maxLag = Math.ceil((fs * 60) / minBpm);

  let bestLag = 0;
  let bestCorr = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let numerator = 0;
    let d1 = 0;
    let d2 = 0;

    for (let i = lag; i < centered.length; i++) {
      const x = centered[i];
      const y = centered[i - lag];

      numerator += x * y;
      d1 += x * x;
      d2 += y * y;
    }

    const corr =
      numerator / Math.sqrt(Math.max(1e-12, d1 * d2));

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (!bestLag) return null;

  return {
    bpm: (60 * fs) / bestLag,
    quality: bestCorr
  };
}

function medianNumber(values) {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function startHeartRate() {
  if (hrActive) return;

  try {
    hrStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 }
      }
    });

    hrTrack = hrStream.getVideoTracks()[0];

    hrVideo.srcObject = hrStream;
    hrVideo.setAttribute("playsinline", "");
    hrVideo.muted = true;

    await hrVideo.play();

    torchEnabled = await tryEnableTorch(hrTrack);

    hrActive = true;
    hrSamples = [];
    stableEstimates = [];
    hrStartedAt = performance.now();
    lastFingerSeenAt = 0;

    $("hrBox").classList.remove("hidden");

    $("hrMsg").textContent =
      "렌즈와 플래시를 검지로 함께 덮고 움직이지 마세요";

    $("hrQ").textContent = torchEnabled
      ? "FLASH ON · 손가락 접촉 대기"
      : "FLASH 제어 미지원 · 밝은 곳에서 측정하세요";

    heartLoop();
  } catch (err) {
    console.error(err);
    alert("후면 카메라를 열 수 없습니다. Safari의 카메라 권한을 확인하세요.");
    stopHeartRate();
  }
}

function stopHeartRate() {
  hrActive = false;

  if (hrRaf) cancelAnimationFrame(hrRaf);
  hrRaf = null;

  stopTorch();

  if (hrStream) {
    hrStream.getTracks().forEach((t) => t.stop());
  }

  hrStream = null;
  hrTrack = null;

  $("hrBox").classList.add("hidden");
}

function heartLoop() {
  if (!hrActive) return;

  hrRaf = requestAnimationFrame(heartLoop);

  if (hrVideo.readyState < 2) return;

  hrCtx.drawImage(hrVideo, 0, 0, 24, 24);

  const data = hrCtx.getImageData(0, 0, 24, 24).data;

  let r = 0;
  let g = 0;
  let b = 0;

  const n = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }

  r /= n;
  g /= n;
  b /= n;

  const brightness = (r + g + b) / 3;
  const redFraction = r / Math.max(1, r + g + b);

  // Finger over an illuminated rear camera usually becomes bright/red.
  const fingerPresent =
    brightness > 22 &&
    r > 45 &&
    redFraction > 0.39;

  const now = performance.now();
  const elapsed = (now - hrStartedAt) / 1000;

  if (fingerPresent) {
    lastFingerSeenAt = now;

    // Normalize the green channel by total intensity.
    // This reduces slow exposure changes while retaining the pulse component.
    const value = g / Math.max(1, r + g + b);

    hrSamples.push({
      t: now,
      v: value
    });

    if (hrSamples.length > 700) {
      hrSamples = hrSamples.slice(-700);
    }
  } else {
    if (
      lastFingerSeenAt &&
      now - lastFingerSeenAt > 500
    ) {
      hrSamples = [];
      stableEstimates = [];
    }
  }

  const est = estimateHeartRate();

  $("hrMsg").textContent =
    "렌즈와 플래시를 덮고 그대로 유지 · " +
    Math.min(20, Math.floor(elapsed)) +
    "s / 20s";

  if (!fingerPresent) {
    $("hrQ").textContent = torchEnabled
      ? "FLASH ON · 손가락 접촉을 확인하세요"
      : "손가락 접촉을 확인하세요";
  } else if (!est) {
    $("hrQ").textContent = torchEnabled
      ? "FLASH ON · PPG 신호 수집 중"
      : "PPG 신호 수집 중";
  } else {
    const qualityPct = Math.max(
      0,
      Math.min(100, Math.round(est.quality * 100))
    );

    $("hrQ").textContent =
      "신호 품질 " +
      qualityPct +
      "% · 약 " +
      Math.round(est.bpm) +
      " bpm";

    if (
      est.quality > 0.32 &&
      est.bpm >= 45 &&
      est.bpm <= 200
    ) {
      stableEstimates.push(est.bpm);

      if (stableEstimates.length > 8) {
        stableEstimates.shift();
      }

      const stableHr = medianNumber(stableEstimates);

      if (stableHr != null) {
        hrLast = stableHr;
        $("hr").textContent = Math.round(stableHr);
        updateHeartRateGuide(stableHr);
      }

      // Good signal for ~15 s: finish early.
      if (
        elapsed >= 15 &&
        stableEstimates.length >= 5
      ) {
        stopHeartRate();
        return;
      }
    }
  }

  if (elapsed >= 20) {
    stopHeartRate();
  }
}

$("hrStart").onclick = startHeartRate;
$("hrCancel").onclick = stopHeartRate;
