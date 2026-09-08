
with open('src/components/AccessGateway.tsx', 'r') as f:
    content = f.read()

# Make the stroke color black/dark-brown in light mode like the image.
# The user said "dont copy the light format there because that supposed to be what it looks like if its in light mode okay"
# In the image, the grid is a light brownish color. The SVG strokes are also brownish/charcoal.
# Let's adjust strokeColor:
content = content.replace(
    'const strokeColor = isDarkMode ? "#fde047" : "#ca8a04";',
    'const strokeColor = isDarkMode ? "#fde047" : "#44403c";' # stone-700
)

# And math formula color:
content = content.replace(
    'text-[#ca8a04]',
    'text-[#44403c]'
)
content = content.replace(
    'border-[#ca8a04]',
    'border-[#44403c]'
)

with open('src/components/AccessGateway.tsx', 'w') as f:
    f.write(content)
