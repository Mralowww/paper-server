import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \TodoItem.createdAt, order: .reverse) private var items: [TodoItem]

    @State private var showingAddSheet = false
    @State private var selectedCategory: TodoCategory? = nil

    private var filteredItems: [TodoItem] {
        guard let selectedCategory else { return items }
        return items.filter { $0.category == selectedCategory }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(filteredItems) { item in
                    TodoRow(item: item)
                }
                .onDelete(perform: deleteItems)
            }
            .overlay {
                if filteredItems.isEmpty {
                    ContentUnavailableView(
                        "目前沒有待辦事項",
                        systemImage: "checklist",
                        description: Text("點右上角「＋」新增一筆")
                    )
                }
            }
            .navigationTitle("待辦事項")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showingAddSheet = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
                ToolbarItem(placement: .navigationBarLeading) {
                    Menu {
                        Button("全部") { selectedCategory = nil }
                        ForEach(TodoCategory.allCases) { category in
                            Button(category.rawValue) { selectedCategory = category }
                        }
                    } label: {
                        Label(selectedCategory?.rawValue ?? "全部", systemImage: "line.3.horizontal.decrease.circle")
                    }
                }
            }
            .sheet(isPresented: $showingAddSheet) {
                AddTodoView()
            }
        }
    }

    private func deleteItems(at offsets: IndexSet) {
        for index in offsets {
            modelContext.delete(filteredItems[index])
        }
    }
}

struct TodoRow: View {
    @Bindable var item: TodoItem

    var body: some View {
        HStack {
            Button {
                item.isCompleted.toggle()
            } label: {
                Image(systemName: item.isCompleted ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(item.isCompleted ? .green : .secondary)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .strikethrough(item.isCompleted)
                    .foregroundStyle(item.isCompleted ? .secondary : .primary)
                HStack(spacing: 8) {
                    Text(item.category.rawValue)
                        .font(.caption)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.thinMaterial, in: Capsule())
                    if let dueDate = item.dueDate {
                        Text(dueDate, style: .date)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

#Preview {
    ContentView()
        .modelContainer(for: TodoItem.self, inMemory: true)
}
