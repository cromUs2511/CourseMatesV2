
with open('src/components/AccessGateway.tsx', 'r') as f:
    content = f.read()

# Update Light Mode background to match image exactly (#FAF8F5)
content = content.replace("bg-[#f8f9fa]", "bg-[#FAF8F5]")
content = content.replace("#f8f9fa", "#FAF8F5")

# Update grid pattern for light mode to match the beige/brownish grid lines in the image
content = content.replace(
    "'linear-gradient(rgba(202, 138, 4, 0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(202, 138, 4, 0.12) 1px, transparent 1px)'",
    "'linear-gradient(rgba(87, 83, 78, 0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(87, 83, 78, 0.15) 1px, transparent 1px)'"
)

# And fix any leftover bg-stone-50 inside the form to be slightly warmer for light mode
content = content.replace("bg-stone-50", "bg-[#F3EFEA]")

with open('src/components/AccessGateway.tsx', 'w') as f:
    f.write(content)
