with open('src/components/AccessGateway.tsx', 'r') as f:
    content = f.read()

# Make the right form section in light mode match the image (which has a cream bg and border)
content = content.replace(
    "isDarkMode ? 'bg-[#181716]' : 'bg-white'",
    "isDarkMode ? 'bg-[#181716]' : 'bg-[#FAF8F5] border-l border-stone-200'"
)

with open('src/components/AccessGateway.tsx', 'w') as f:
    f.write(content)
