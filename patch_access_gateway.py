
with open('src/components/AccessGateway.tsx', 'r') as f:
    content = f.read()

# Add isChalkboardMode state
content = content.replace(
    "const [successNotice, setSuccessNotice] = useState<string | null>(null);",
    "const [successNotice, setSuccessNotice] = useState<string | null>(null);\n  const [isChalkboardMode, setIsChalkboardMode] = useState(true);"
)

# We need to replace the return statement with the conditional render.
return_split = content.split("  return (\n")
before_return = return_split[0]
after_return = return_split[1]

# We will wrap the existing UI in a block and add the Chalkboard UI
# But first, let's extract the form content so we can reuse it? No, the user wants EXACTLY the form from the image for the chalkboard mode.
# The image form has slightly different colors (red button, dark bg, yellow borders etc).
