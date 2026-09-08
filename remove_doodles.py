
with open('src/components/AccessGateway.tsx', 'r') as f:
    content = f.read()

# We need to remove the doodles but keep the Main Titles.
# The section to remove starts with "        {/* Book (Top Left) */}"
# and ends right before "        {/* Main Titles */}"

start_marker = "        {/* Book (Top Left) */}"
end_marker = "        {/* Main Titles */}"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx != -1 and end_idx != -1:
    new_content = content[:start_idx] + content[end_idx:]
    with open('src/components/AccessGateway.tsx', 'w') as f:
        f.write(new_content)
    print("Doodles removed successfully.")
else:
    print("Markers not found.")

