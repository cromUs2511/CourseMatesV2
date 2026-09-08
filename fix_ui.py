
with open('src/components/AccessGateway.tsx', 'r') as f:
    content = f.read()

# Create an inner container
left_section_start = """      {/* Left Art Section (Chalkboard / Whiteboard) */}
      <div 
        className={`hidden md:flex flex-1 relative items-center justify-center border-r ${isDarkMode ? 'border-stone-800' : 'border-stone-300'}`}
        style={{
          backgroundImage: gridPattern,
          backgroundSize: '40px 40px'
        }}
      >"""

left_section_inner = """      {/* Left Art Section (Chalkboard / Whiteboard) */}
      <div 
        className={`hidden md:flex flex-1 relative items-center justify-center border-r ${isDarkMode ? 'border-stone-800' : 'border-stone-300'}`}
        style={{
          backgroundImage: gridPattern,
          backgroundSize: '40px 40px'
        }}
      >
        <div className="relative w-[600px] h-[600px] flex flex-col items-center justify-center">"""

content = content.replace(left_section_start, left_section_inner)

# Close the inner container right before the right form section
# The right form section starts with: {/* Right Form Section */}
right_section_start = "      {/* Right Form Section */}"
content = content.replace(right_section_start, "        </div>\n" + right_section_start)

# Remove animations
content = content.replace("animate-spin-slow-reverse", "")
content = content.replace("animate-spin-slow", "")

with open('src/components/AccessGateway.tsx', 'w') as f:
    f.write(content)

