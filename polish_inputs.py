
with open('src/components/AccessGateway.tsx', 'r') as f:
    content = f.read()

# Make the right form container feel a bit more structured
content = content.replace(
    "isDarkMode ? 'bg-[#181716]' : 'bg-[#FAF8F5] border-l border-stone-200'",
    "isDarkMode ? 'bg-[#181716]' : 'bg-white border-l border-stone-200 shadow-[[-10px_0_30px_rgba(0,0,0,0.02)]]'"
)

# Darken labels slightly in light mode for better contrast
content = content.replace("text-[#b45309]", "text-[#9a3412]")

with open('src/components/AccessGateway.tsx', 'w') as f:
    f.write(content)
