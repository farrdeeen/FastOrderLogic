export default function ChatInfoPanel({ chat }) {
  if (!chat) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        No user selected
      </div>
    );
  }

  return (
    <div className="p-4">
      <h3 className="font-semibold mb-2">User Info</h3>
      <p>Name: {chat.name}</p>
      <p>Last message: {chat.lastMsg}</p>
    </div>
  );
}
