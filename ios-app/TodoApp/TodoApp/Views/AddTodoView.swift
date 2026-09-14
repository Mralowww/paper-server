import SwiftUI
import SwiftData

struct AddTodoView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var title: String = ""
    @State private var category: TodoCategory = .personal
    @State private var hasDueDate: Bool = false
    @State private var dueDate: Date = .now

    var body: some View {
        NavigationStack {
            Form {
                Section("內容") {
                    TextField("要做什麼？", text: $title)
                }

                Section("分類") {
                    Picker("分類", selection: $category) {
                        ForEach(TodoCategory.allCases) { category in
                            Text(category.rawValue).tag(category)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section("到期日") {
                    Toggle("設定到期日", isOn: $hasDueDate)
                    if hasDueDate {
                        DatePicker("到期日", selection: $dueDate, displayedComponents: [.date])
                    }
                }
            }
            .navigationTitle("新增待辦")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("儲存") {
                        save()
                    }
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private func save() {
        let newItem = TodoItem(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            category: category,
            dueDate: hasDueDate ? dueDate : nil
        )
        modelContext.insert(newItem)
        dismiss()
    }
}

#Preview {
    AddTodoView()
        .modelContainer(for: TodoItem.self, inMemory: true)
}
