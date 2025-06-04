# Low Hashrate Mode

Low hashrate mode keeps the dashboard readable for hobbyist setups or short outages. When active, the chart switches to the steadier three hour average and adds padding so the 24‑hour line remains visible even if the current rate is near zero. The state is stored in `localStorage` so the mode persists across page reloads.

## Detection thresholds

The front‑end in `static/js/main.js` monitors the normalized 60‑second hashrate. If it stays below **0.01&nbsp;TH/s** for a full minute while the 3‑hour average is higher, the interface enters low hashrate mode. It remains in that mode until the 60‑second rate rises above **20&nbsp;TH/s** for at least two minutes with three consecutive spikes. Mode changes are throttled to occur no more than once every two minutes.

The notification service uses a simpler rule. When the 3‑hour average is under **3&nbsp;TH/s**, hashrate alerts are based on 3‑hour data rather than 10‑minute averages.

## Configuration

Low hashrate mode does not currently expose any settings in `config.json`. The thresholds are hard coded at **0.01&nbsp;TH/s** for entry and **20&nbsp;TH/s** for exit. The configuration key `low_hashrate_threshold_ths` only influences the notification service and does not change the chart behavior. If future versions add configurable keys they will be documented here.
