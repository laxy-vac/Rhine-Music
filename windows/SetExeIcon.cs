
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class RhineExecutableIconResource
{
    private const uint LoadLibraryAsDataFile = 0x00000002;
    private const uint LoadLibraryAsImageResource = 0x00000020;
    private const int ResourceTypeNotFound = 1813;
    private const int RtIcon = 3;
    private const int RtGroupIcon = 14;

    [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private delegate bool EnumNamesCallback(IntPtr module, IntPtr type, IntPtr name, IntPtr parameter);

    [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private delegate bool EnumLanguagesCallback(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr parameter);

    private sealed class ResourceName
    {
        public bool IsId;
        public ushort Id;
        public string Text;
        public string Key { get { return IsId ? "#" + Id.ToString() : "$" + Text; } }
    }

    private sealed class GroupRef
    {
        public ResourceName Name;
        public ushort Language;
        public string Key { get { return Name.Key + ":" + Language.ToString(); } }
    }

    private sealed class IconFrame
    {
        public ushort Width;
        public ushort Height;
        public byte[] Data;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [DllImport("kernel32.dll", EntryPoint = "LoadLibraryExW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibraryEx(string fileName, IntPtr file, uint flags);

    [DllImport("kernel32.dll", EntryPoint = "FreeLibrary", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FreeLibrary(IntPtr module);

    [DllImport("kernel32.dll", EntryPoint = "EnumResourceNamesW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumResourceNames(IntPtr module, IntPtr type, EnumNamesCallback callback, IntPtr parameter);

    [DllImport("kernel32.dll", EntryPoint = "EnumResourceLanguagesW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, EnumLanguagesCallback callback, IntPtr parameter);

    [DllImport("kernel32.dll", EntryPoint = "FindResourceExW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindResourceEx(IntPtr module, IntPtr type, IntPtr name, ushort language);

    [DllImport("kernel32.dll", EntryPoint = "SizeofResource", SetLastError = true)]
    private static extern uint SizeofResource(IntPtr module, IntPtr resource);

    [DllImport("kernel32.dll", EntryPoint = "LoadResource", SetLastError = true)]
    private static extern IntPtr LoadResource(IntPtr module, IntPtr resource);

    [DllImport("kernel32.dll", EntryPoint = "LockResource", SetLastError = true)]
    private static extern IntPtr LockResource(IntPtr resourceData);

    [DllImport("kernel32.dll", EntryPoint = "BeginUpdateResourceW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr BeginUpdateResource(string fileName, [MarshalAs(UnmanagedType.Bool)] bool deleteExistingResources);

    [DllImport("kernel32.dll", EntryPoint = "UpdateResourceW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);

    [DllImport("kernel32.dll", EntryPoint = "EndUpdateResourceW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EndUpdateResource(IntPtr update, [MarshalAs(UnmanagedType.Bool)] bool discard);

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);

    [DllImport("kernel32.dll", EntryPoint = "GetFileInformationByHandle", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation information);

    private static Exception Win32Failure(string operation)
    {
        return new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }

    private static FileInformation GetFileInformation(string path)
    {
        const uint FileReadAttributes = 0x00000080;
        const uint ShareReadWriteDelete = 0x00000007;
        const uint OpenExisting = 3;
        const uint FileAttributeNormal = 0x00000080;
        using (SafeFileHandle handle = CreateFile(path, FileReadAttributes, ShareReadWriteDelete,
            IntPtr.Zero, OpenExisting, FileAttributeNormal, IntPtr.Zero))
        {
            if (handle == null || handle.IsInvalid) throw Win32Failure("Could not inspect executable file identity");
            FileInformation information;
            if (!GetFileInformationByHandle(handle, out information))
                throw Win32Failure("Could not inspect executable file identity");
            return information;
        }
    }

    private static bool IsSameFile(string left, string right)
    {
        FileInformation a = GetFileInformation(left);
        FileInformation b = GetFileInformation(right);
        return a.VolumeSerialNumber == b.VolumeSerialNumber &&
               a.FileIndexHigh == b.FileIndexHigh && a.FileIndexLow == b.FileIndexLow;
    }

    private static ResourceName DecodeName(IntPtr value)
    {
        long raw = value.ToInt64();
        if ((unchecked((ulong)raw) >> 16) == 0)
            return new ResourceName { IsId = true, Id = (ushort)(raw & 0xffff) };
        return new ResourceName { IsId = false, Text = Marshal.PtrToStringUni(value) };
    }

    private static IntPtr EncodeName(ResourceName name)
    {
        return name.IsId ? new IntPtr((int)name.Id) : Marshal.StringToHGlobalUni(name.Text);
    }

    private static void ReleaseName(ResourceName name, IntPtr value)
    {
        if (!name.IsId && value != IntPtr.Zero) Marshal.FreeHGlobal(value);
    }

    private static IntPtr OpenAsData(string path)
    {
        IntPtr module = LoadLibraryEx(path, IntPtr.Zero, LoadLibraryAsDataFile | LoadLibraryAsImageResource);
        if (module == IntPtr.Zero) throw Win32Failure("Could not map the executable as data");
        return module;
    }

    private static List<ResourceName> EnumerateNames(IntPtr module, int resourceType)
    {
        List<ResourceName> names = new List<ResourceName>();
        EnumNamesCallback callback = delegate(IntPtr ignoredModule, IntPtr ignoredType, IntPtr name, IntPtr ignoredParameter)
        {
            names.Add(DecodeName(name));
            return true;
        };
        bool ok = EnumResourceNames(module, new IntPtr(resourceType), callback, IntPtr.Zero);
        GC.KeepAlive(callback);
        if (!ok)
        {
            int error = Marshal.GetLastWin32Error();
            if (error == ResourceTypeNotFound) return names;
            throw new Win32Exception(error, "Could not enumerate executable resource names");
        }
        return names;
    }

    private static List<ushort> EnumerateLanguages(IntPtr module, int resourceType, ResourceName name)
    {
        List<ushort> languages = new List<ushort>();
        IntPtr namePointer = EncodeName(name);
        try
        {
            EnumLanguagesCallback callback = delegate(IntPtr ignoredModule, IntPtr ignoredType, IntPtr ignoredName, ushort language, IntPtr ignoredParameter)
            {
                languages.Add(language);
                return true;
            };
            bool ok = EnumResourceLanguages(module, new IntPtr(resourceType), namePointer, callback, IntPtr.Zero);
            GC.KeepAlive(callback);
            if (!ok) throw Win32Failure("Could not enumerate resource languages");
        }
        finally { ReleaseName(name, namePointer); }
        if (languages.Count == 0) throw new InvalidDataException("A resource group has no language entries.");
        return languages;
    }

    private static List<GroupRef> EnumerateGroups(IntPtr module)
    {
        List<GroupRef> groups = new List<GroupRef>();
        foreach (ResourceName name in EnumerateNames(module, RtGroupIcon))
            foreach (ushort language in EnumerateLanguages(module, RtGroupIcon, name))
                groups.Add(new GroupRef { Name = name, Language = language });
        return groups;
    }

    private static byte[] ReadResource(IntPtr module, int resourceType, ResourceName name, ushort language)
    {
        IntPtr namePointer = EncodeName(name);
        try
        {
            IntPtr resource = FindResourceEx(module, new IntPtr(resourceType), namePointer, language);
            if (resource == IntPtr.Zero) throw Win32Failure("Could not find an executable resource");
            uint size = SizeofResource(module, resource);
            if (size == 0 || size > Int32.MaxValue) throw new InvalidDataException("Executable resource has an invalid size.");
            IntPtr loaded = LoadResource(module, resource);
            if (loaded == IntPtr.Zero) throw Win32Failure("Could not load an executable resource");
            IntPtr data = LockResource(loaded);
            if (data == IntPtr.Zero) throw Win32Failure("Could not lock an executable resource");
            byte[] result = new byte[(int)size];
            Marshal.Copy(data, result, 0, result.Length);
            return result;
        }
        finally { ReleaseName(name, namePointer); }
    }

    private static uint ReadUInt32BigEndian(byte[] data, int offset)
    {
        return ((uint)data[offset] << 24) | ((uint)data[offset + 1] << 16) |
               ((uint)data[offset + 2] << 8) | data[offset + 3];
    }

    private static List<IconFrame> ReadIco(string path)
    {
        byte[] ico = File.ReadAllBytes(path);
        if (ico.Length < 6 || BitConverter.ToUInt16(ico, 0) != 0 || BitConverter.ToUInt16(ico, 2) != 1)
            throw new InvalidDataException("The icon input is not a Windows ICO file.");
        int count = BitConverter.ToUInt16(ico, 4);
        int directoryEnd = 6 + count * 16;
        if (count == 0 || count > 32 || directoryEnd > ico.Length)
            throw new InvalidDataException("The ICO directory has an invalid frame count or length.");

        List<IconFrame> frames = new List<IconFrame>();
        List<Tuple<ulong, ulong>> ranges = new List<Tuple<ulong, ulong>>();
        HashSet<string> dimensions = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < count; i++)
        {
            int entry = 6 + i * 16;
            int width = ico[entry] == 0 ? 256 : ico[entry];
            int height = ico[entry + 1] == 0 ? 256 : ico[entry + 1];
            uint byteCount = BitConverter.ToUInt32(ico, entry + 8);
            uint offset = BitConverter.ToUInt32(ico, entry + 12);
            ulong end = (ulong)offset + byteCount;
            if (ico[entry + 3] != 0 || width != height ||
                (width != 16 && width != 24 && width != 32 && width != 48 && width != 64 && width != 128 && width != 256) ||
                !dimensions.Add(width.ToString()) || byteCount < 24 || offset < directoryEnd || end > (ulong)ico.Length)
                throw new InvalidDataException("The ICO contains an invalid, duplicate, or unsupported frame.");
            for (int previous = 0; previous < ranges.Count; previous++)
                if ((ulong)offset < ranges[previous].Item2 && end > ranges[previous].Item1)
                    throw new InvalidDataException("ICO image data ranges overlap.");
            ranges.Add(Tuple.Create((ulong)offset, end));

            byte[] image = new byte[(int)byteCount];
            Buffer.BlockCopy(ico, (int)offset, image, 0, image.Length);
            if (image[0] != 0x89 || image[1] != 0x50 || image[2] != 0x4e || image[3] != 0x47 ||
                image[4] != 0x0d || image[5] != 0x0a || image[6] != 0x1a || image[7] != 0x0a ||
                ReadUInt32BigEndian(image, 8) != 13 || image[12] != (byte)'I' || image[13] != (byte)'H' ||
                image[14] != (byte)'D' || image[15] != (byte)'R' ||
                ReadUInt32BigEndian(image, 16) != (uint)width || ReadUInt32BigEndian(image, 20) != (uint)height)
                throw new InvalidDataException("Every ICO frame must be a PNG whose IHDR matches its directory dimensions.");
            frames.Add(new IconFrame { Width = (ushort)width, Height = (ushort)height, Data = image });
        }
        int[] requiredSizes = new int[] { 16, 24, 32, 48, 64, 128, 256 };
        if (frames.Count != requiredSizes.Length)
            throw new InvalidDataException("The application ICO must contain seven PNG frames.");
        foreach (int requiredSize in requiredSizes)
            if (!dimensions.Contains(requiredSize.ToString()))
                throw new InvalidDataException("The application ICO is missing a required PNG size: " + requiredSize.ToString());
        return frames;
    }

    private static void WriteUInt16(byte[] data, int offset, ushort value)
    {
        byte[] bytes = BitConverter.GetBytes(value);
        data[offset] = bytes[0];
        data[offset + 1] = bytes[1];
    }

    private static void WriteUInt32(byte[] data, int offset, uint value)
    {
        byte[] bytes = BitConverter.GetBytes(value);
        data[offset] = bytes[0];
        data[offset + 1] = bytes[1];
        data[offset + 2] = bytes[2];
        data[offset + 3] = bytes[3];
    }

    private static ushort ReadUInt16(byte[] data, int offset)
    {
        return BitConverter.ToUInt16(data, offset);
    }

    private static uint ReadUInt32(byte[] data, int offset)
    {
        return BitConverter.ToUInt32(data, offset);
    }

    private static byte[] BuildGroupIcon(List<IconFrame> frames, List<ushort> iconIds)
    {
        byte[] group = new byte[6 + frames.Count * 14];
        WriteUInt16(group, 0, 0);
        WriteUInt16(group, 2, 1);
        WriteUInt16(group, 4, (ushort)frames.Count);
        for (int i = 0; i < frames.Count; i++)
        {
            int entry = 6 + i * 14;
            group[entry] = frames[i].Width == 256 ? (byte)0 : (byte)frames[i].Width;
            group[entry + 1] = frames[i].Height == 256 ? (byte)0 : (byte)frames[i].Height;
            group[entry + 2] = 0;
            group[entry + 3] = 0;
            WriteUInt16(group, entry + 4, 1);
            WriteUInt16(group, entry + 6, 32);
            WriteUInt32(group, entry + 8, (uint)frames[i].Data.Length);
            WriteUInt16(group, entry + 12, iconIds[i]);
        }
        return group;
    }

    private static void Update(IntPtr update, int resourceType, ResourceName name, ushort language, byte[] data)
    {
        IntPtr namePointer = EncodeName(name);
        try
        {
            if (!UpdateResource(update, new IntPtr(resourceType), namePointer, language, data, (uint)data.Length))
                throw Win32Failure("Could not update an executable icon resource");
        }
        finally { ReleaseName(name, namePointer); }
    }

    private static bool SameGroupRefs(List<GroupRef> left, List<GroupRef> right)
    {
        if (left.Count != right.Count) return false;
        HashSet<string> keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (GroupRef item in left) keys.Add(item.Key);
        foreach (GroupRef item in right) if (!keys.Remove(item.Key)) return false;
        return keys.Count == 0;
    }

    private static void Verify(string exePath, List<IconFrame> frames, List<ushort> iconIds, List<GroupRef> expectedGroups)
    {
        IntPtr module = OpenAsData(exePath);
        try
        {
            List<GroupRef> groups = EnumerateGroups(module);
            if (!SameGroupRefs(expectedGroups, groups))
                throw new InvalidDataException("The executable icon-group inventory changed during update.");
            foreach (GroupRef group in groups)
            {
                byte[] bytes = ReadResource(module, RtGroupIcon, group.Name, group.Language);
                if (bytes.Length != 6 + frames.Count * 14 || ReadUInt16(bytes, 0) != 0 ||
                    ReadUInt16(bytes, 2) != 1 || ReadUInt16(bytes, 4) != frames.Count)
                    throw new InvalidDataException("The executable icon group did not read back as expected.");
                for (int i = 0; i < frames.Count; i++)
                {
                    int entry = 6 + i * 14;
                    int width = bytes[entry] == 0 ? 256 : bytes[entry];
                    int height = bytes[entry + 1] == 0 ? 256 : bytes[entry + 1];
                    if (width != frames[i].Width || height != frames[i].Height ||
                        ReadUInt16(bytes, entry + 4) != 1 || ReadUInt16(bytes, entry + 6) != 32 ||
                        ReadUInt32(bytes, entry + 8) != frames[i].Data.Length ||
                        ReadUInt16(bytes, entry + 12) != iconIds[i])
                        throw new InvalidDataException("An executable icon-group entry differs from the input ICO.");
                    byte[] image = ReadResource(module, RtIcon,
                        new ResourceName { IsId = true, Id = iconIds[i] }, group.Language);
                    if (image.Length != frames[i].Data.Length)
                        throw new InvalidDataException("An executable PNG icon frame has an unexpected length.");
                    for (int n = 0; n < image.Length; n++)
                        if (image[n] != frames[i].Data[n])
                            throw new InvalidDataException("An executable PNG icon frame differs from the input ICO bytes.");
                }
            }
        }
        finally { FreeLibrary(module); }
    }

    public static void Apply(string exePath, string icoPath, string sourceRuntime)
    {
        if (String.Equals(exePath, sourceRuntime, StringComparison.OrdinalIgnoreCase) || IsSameFile(exePath, sourceRuntime))
            throw new InvalidOperationException("Refusing to modify the source-preview Electron runtime or a hard link to it.");
        List<IconFrame> frames = ReadIco(icoPath);
        List<GroupRef> groups;
        HashSet<ushort> usedIconIds = new HashSet<ushort>();
        IntPtr module = OpenAsData(exePath);
        try
        {
            foreach (ResourceName name in EnumerateNames(module, RtIcon))
                if (name.IsId) usedIconIds.Add(name.Id);
            groups = EnumerateGroups(module);
        }
        finally { FreeLibrary(module); }

        if (groups.Count == 0)
            groups.Add(new GroupRef { Name = new ResourceName { IsId = true, Id = 1 }, Language = 0 });

        List<ushort> iconIds = new List<ushort>();
        for (int candidate = 1; candidate <= UInt16.MaxValue && iconIds.Count < frames.Count; candidate++)
            if (!usedIconIds.Contains((ushort)candidate)) iconIds.Add((ushort)candidate);
        if (iconIds.Count != frames.Count)
            throw new InvalidDataException("No unused numeric RT_ICON resource IDs are available.");

        IntPtr update = BeginUpdateResource(exePath, false);
        if (update == IntPtr.Zero) throw Win32Failure("Could not begin the executable resource update");
        try
        {
            HashSet<ushort> languages = new HashSet<ushort>();
            foreach (GroupRef group in groups) languages.Add(group.Language);
            foreach (ushort language in languages)
            {
                for (int i = 0; i < frames.Count; i++)
                    Update(update, RtIcon, new ResourceName { IsId = true, Id = iconIds[i] }, language, frames[i].Data);
            }
            byte[] groupBytes = BuildGroupIcon(frames, iconIds);
            foreach (GroupRef group in groups)
                Update(update, RtGroupIcon, group.Name, group.Language, groupBytes);
            if (!EndUpdateResource(update, false))
            {
                int error = Marshal.GetLastWin32Error();
                update = IntPtr.Zero;
                throw new Win32Exception(error, "Could not commit the executable icon resources");
            }
            update = IntPtr.Zero;
        }
        finally
        {
            if (update != IntPtr.Zero) EndUpdateResource(update, true);
        }

        Verify(exePath, frames, iconIds, groups);
        Console.WriteLine("Updated and read back " + groups.Count.ToString() + " icon group(s) with " + frames.Count.ToString() + " PNG frame(s).");
    }
}
public static class SetExeIconProgram
{
    private static void AssertNoReparsePoints(string path, string projectRoot)
    {
        string prefix = projectRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string current = path;
        while (true)
        {
            FileAttributes attributes = File.GetAttributes(current);
            if ((attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException("Refusing a link or reparse point in the executable icon path: " + current);
            if (String.Equals(current, projectRoot, StringComparison.OrdinalIgnoreCase)) return;
            if (!current.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                throw new IOException("An executable icon path escaped the project root: " + current);
            string parent = Path.GetDirectoryName(current);
            if (String.IsNullOrEmpty(parent) || String.Equals(parent, current, StringComparison.OrdinalIgnoreCase))
                throw new IOException("Could not reach the project root while checking: " + path);
            current = parent;
        }
    }

    public static int Main(string[] args)
    {
        try
        {
            if (args == null || args.Length != 4)
                throw new ArgumentException("Expected target executable, ICO input, source runtime, and project root.");

            string target = Path.GetFullPath(args[0]);
            string icon = Path.GetFullPath(args[1]);
            string sourceRuntime = Path.GetFullPath(args[2]);
            string projectRoot = Path.GetFullPath(args[3]).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string releaseRoot = Path.GetFullPath(Path.Combine(projectRoot, ".tools", "build", "windows"));
            string releasePrefix = releaseRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string expectedIcon = Path.GetFullPath(Path.Combine(projectRoot, "windows", "app.ico"));
            string expectedRuntime = Path.GetFullPath(Path.Combine(projectRoot, ".tools", "source-preview-electron", "electron.exe"));

            if (!target.StartsWith(releasePrefix, StringComparison.OrdinalIgnoreCase))
                throw new IOException("The icon target must be inside this project's release output directory.");
            if (String.Equals(target, sourceRuntime, StringComparison.OrdinalIgnoreCase))
                throw new IOException("Refusing to modify the source-preview Electron runtime.");
            if (!String.Equals(Path.GetFileName(target), "Rhine Music.exe", StringComparison.OrdinalIgnoreCase))
                throw new IOException("The target must be the copied Rhine Music.exe.");
            if (!String.Equals(icon, expectedIcon, StringComparison.OrdinalIgnoreCase))
                throw new IOException("The ICO input must be this project's windows/app.ico.");
            if (!String.Equals(sourceRuntime, expectedRuntime, StringComparison.OrdinalIgnoreCase))
                throw new IOException("The source-runtime guard must point to this project's source-preview Electron executable.");

            AssertNoReparsePoints(target, projectRoot);
            AssertNoReparsePoints(icon, projectRoot);
            AssertNoReparsePoints(sourceRuntime, projectRoot);
            if (!File.Exists(target) || !File.Exists(icon) || !File.Exists(sourceRuntime))
                throw new FileNotFoundException("The executable, ICO input, or source-preview runtime is missing.");
            RhineExecutableIconResource.Apply(target, icon, sourceRuntime);
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.ToString());
            return 1;
        }
    }
}
