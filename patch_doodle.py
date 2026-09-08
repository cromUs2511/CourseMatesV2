
with open('src/components/AccessGateway.tsx', 'r') as f:
    content = f.read()

# 1. Update Grid Pattern to be yellow
grid_old = """const gridPattern = isDarkMode
    ? 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)'
    : 'linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)';"""

grid_new = """const strokeColor = isDarkMode ? "#fde047" : "#ca8a04";
  const gridPattern = isDarkMode
    ? 'linear-gradient(rgba(253, 224, 71, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(253, 224, 71, 0.08) 1px, transparent 1px)'
    : 'linear-gradient(rgba(202, 138, 4, 0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(202, 138, 4, 0.12) 1px, transparent 1px)';"""

content = content.replace("const strokeColor = isDarkMode ? \"#fde047\" : \"#334155\";\n  const gridPattern = isDarkMode\n    ? 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)'\n    : 'linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)';", grid_new)

# 2. Add Doodle Filter
doodle_svg = """      {/* SVG Filters for Doodle/Chalk Effect */}
      <svg className="absolute w-0 h-0" aria-hidden="true">
        <defs>
          <filter id="doodle-effect" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      
      {/* Left Art Section (Chalkboard / Whiteboard) */}"""

content = content.replace("{/* Left Art Section (Chalkboard / Whiteboard) */}", doodle_svg)

# 3. Apply Filter and adjust strokeWidth/opacity to the SVGs
# For all <svg width="..." height="..." ... > in the Left Art Section, we add style={{ filter: 'url(#doodle-effect)', opacity: 0.75 }} 
# and increase strokeWidth="1.5" to strokeWidth="2.5" to keep them visible when faded.

content = content.replace("strokeWidth=\"1.5\"", "strokeWidth=\"2.5\"")
content = content.replace("<svg width=", "<svg style={{ filter: 'url(#doodle-effect)', opacity: 0.75 }} width=")

# 4. Make Math formula look handwritten
math_old = """<div className={`absolute bottom-[15%] right-[8%] opacity-90 font-serif text-3xl md:text-5xl flex items-center ${isDarkMode ? 'text-[#fde047]' : 'text-slate-700'}`}>"""
math_new = """<div className={`absolute bottom-[15%] right-[8%] opacity-80 font-serif italic text-3xl md:text-5xl flex items-center ${isDarkMode ? 'text-[#fde047]' : 'text-[#ca8a04]'}`} style={{ filter: 'url(#doodle-effect)' }}>"""
content = content.replace(math_old, math_new)

# Update border in the math formula
content = content.replace("border-slate-700", "border-[#ca8a04]")

# Ensure the abstract node graph is aligned
content = content.replace("text-[#fde047]' : 'text-slate-700'", "text-[#fde047]' : 'text-[#ca8a04]'")

with open('src/components/AccessGateway.tsx', 'w') as f:
    f.write(content)
