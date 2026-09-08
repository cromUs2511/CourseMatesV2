import re

with open('src/components/TopMusicBar.tsx', 'r') as f:
    content = f.read()

# Remove the unused refs
content = content.replace("const audioContextRef = useRef<AudioContext | null>(null);", "")
content = content.replace("const ambientOscRef = useRef<OscillatorNode | null>(null);", "")

# Remove startAmbientTone definition
start_regex = re.compile(r"// Subtle ambient tone synth generator for focus\s*const startAmbientTone = \(\) => \{.*?\};\s*const stopAmbientTone = \(\) => \{.*?\};", re.DOTALL)
content = start_regex.sub("", content)

# Remove startAmbientTone and stopAmbientTone calls
content = content.replace("startAmbientTone();", "")
content = content.replace("stopAmbientTone();", "")

with open('src/components/TopMusicBar.tsx', 'w') as f:
    f.write(content)
