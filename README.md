# Flocking: a body-driven boids installation

A swarm of boids on a projected screen reacts to the people standing in front of a camera. MoveNet tracks up to six bodies, and the joints you pick (wrists, nose, ankles, any of 17) become attractors or repellers in the flock. Nobody touches an interface. The operator tunes the physics live, and the people in the room move the swarm.

Developed for the research project [INTRA – Designing Embodied Human-Data IntraActions](https://intra.projects.unibz.it) at the Free University of Bozen-Bolzano.

## How it works

- Boids apply separation, alignment and cohesion twice: once to each other, once to body joints. Each rule has its own radius and a signed weight from −6 to +6, so negative cohesion makes people push the swarm away.
- The simulation runs in a Web Worker with a spatial hash grid and double-buffered transferable arrays. Boids render as GL points through a custom shader, in one draw call.
- Pose detection (TensorFlow.js on WebGPU) runs in its own loop, so the flock never waits for the model.
- A Canvas 2D overlay can show skeletons, interaction radii, trails, centre-of-mass lines, density and speed heatmaps, and a velocity flow field.

## Controls

- **Laptop controls window.** Tabs for pose, boids, appearance and a randomizer, a live diagram of each boid's perception, scene export with selective import, and MP4 recording.
- **Phone controller** over the LAN (scan the QR code). Up to 8 sliders and 12 toggles you assign to any parameter, six switchable mapping layers, per-joint faders and a scene remote.
- **Scene manager.** A playlist of saved scenes with eased transitions (8 curves, 0–30 s) and an optional fade that hides population changes.

## Multiple projectors

Run one machine as master and the rest as slaves. Parameters follow the master frame by frame, while each machine keeps its own camera and detection settings.

## Running

Needs Google Chrome (for WebGPU) and Node.js 18 or newer. The launchers target macOS.

```bash
./start.command
```

The launcher checks and repairs dependencies, then opens Chrome. Browser libraries and the MoveNet weights are vendored in `app/vendor/`, so it runs offline after the first setup.

See `RUNNING.md` for operation and `DOCUMENTATION.md` for architecture.

## Credits

This project was developed for [INTRA – Designing Embodied Human-Data IntraActions](https://intra.projects.unibz.it), a research project of the Free University of Bozen-Bolzano.

System design, user interface design and LLM-assisted implementation by Rocco Lorenzo Modugno and Andrea Maffei, commissioned by the INTRA project.
