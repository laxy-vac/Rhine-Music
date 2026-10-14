/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 11 авг. 2022 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_FMT_LNK_TYPES_H_
#define LSP_PLUG_IN_FMT_LNK_TYPES_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/types.h>

namespace lsp
{
    namespace lnk
    {
        /* Shell Link (.LNK) Binary File Format consists of following elements:
         *
         *   SHELL_LINK = SHELL_LINK_HEADER [LINKTARGET_IDLIST] [LINKINFO] [STRING_DATA] *EXTRA_DATA
         *
         *   * SHELL_LINK_HEADER   - A shlink_header_t structure, which
         *                           contains identification information, timestamps,
         *                           and flags that specify the presence of optional structures.
         *   * LINKTARGET_IDLIST   - An optional shlink_target_idlist_t structure,
         *                           which specifies the target of the link. The presence of
         *                           this structure is specified by the SHLINK_HAS_LINK_TARGET_IDLIST bit
         *                           in the SHELL_LINK_HEADER.
         *   * LINKINFO            - An optional shlink_link_info_t structure, which specifies information
         *                           necessary to resolve the link target. The presence of this structure
         *                           is specified by the SHLINK_HAS_LINK_INFO bit (shlink_flags_t section) in the
         *                           SHELL_LINK_HEADER.
         *   * STRING_DATA         - Zero or more optional string_data_t structures, which are used to convey
         *                           user interface and path identification information. The presence of these
         *                           structures is specified by bits (shlink_flags_t) in the SHELL_LINK_HEADER.
         *   * EXTRA_DATA          - Zero or more extra_data_t structures.
         *
         * STRING_DATA refers to a set of structures that convey user interface and path identification information.
         *   The presence of these optional structures is controlled by shlink_flags_t in the shlink_header_t.
         *   The string_data_t structures conform to the following rules:
         *
         *   STRING_DATA = [NAME_STRING] [RELATIVE_PATH] [WORKING_DIR] [COMMAND_LINE_ARGUMENTS] [ICON_LOCATION]
         *
         *   * NAME_STRING: An optional structure that specifies a description of the shortcut that is displayed to
         *                  end users to identify the purpose of the shell link. This structure MUST be present if the
         *                  SHLINK_HAS_NAME flag is set.
         *   * RELATIVE_PATH: An optional structure that specifies the location of the link target relative to the
         *                  file that contains the shell link. When specified, this string SHOULD be used when resolving
         *                  the link. This structure MUST be present if the SHLINK_HAS_RELATIVE_PATH flag is set.
         *   * WORKING_DIR: An optional structure that specifies the file system path of the working directory to be used
         *                  when activating the link target. This structure MUST be present if the SHLINK_HAS_WORKING_DIR
         *                  flag is set.
         *   * COMMAND_LINE_ARGUMENTS: An optional structure that stores the command-line arguments that are specified when
         *                  activating the link target. This structure MUST be present if the SHLINK_HAS_ARGUMENTS flag is set.
         *   * ICON_LOCATION: An optional structure that specifies the location of the icon to be used when displaying a shell
         *                  link item in an icon view. This structure MUST be present if the SHLINK_HAS_ICON_LOCATION flag is set.
         *
         * EXTRA_DATA refers to a set of structures that convey additional information about a link target. These optional
         * structures can be present in an extra data section that is appended to the basic Shell Link Binary File Format.
         * The ExtraData structures conform to the following rules:
         *
         *    EXTRA_DATA = *EXTRA_DATA_BLOCK TERMINAL_BLOCK
         *
         *    EXTRA_DATA_BLOCK = CONSOLE_PROPS / CONSOLE_FE_PROPS / DARWIN_PROPS /
         *                       ENVIRONMENT_PROPS / ICON_ENVIRONMENT_PROPS /
         *                       KNOWN_FOLDER_PROPS / PROPERTY_STORE_PROPS /
         *                       SHIM_PROPS / SPECIAL_FOLDER_PROPS /
         *                       TRACKER_PROPS / VISTA_AND_ABOVE_IDLIST_PROPS
         *
         * EXTRA_DATA: A structure consisting of zero or more property data blocks followed by a terminal block.
         *
         * EXTRA_DATA_BLOCK: A structure consisting of any one of the following property data blocks.
         *
         *   * CONSOLE_PROPS: A ConsoleDataBlock structure.
         *   * CONSOLE_FE_PROPS: A ConsoleFEDataBlock structure.
         *   * DARWIN_PROPS: A DarwinDataBlock structure.
         *   * ENVIRONMENT_PROPS: An EnvironmentVariableDataBlock structure.
         *   * ICON_ENVIRONMENT_PROPS: An IconEnvironmentDataBlock structure.
         *   * KNOWN_FOLDER_PROPS: A KnownFolderDataBlock structure.
         *   * PROPERTY_STORE_PROPS: A PropertyStoreDataBlock structure.
         *   * SHIM_PROPS: A ShimDataBlock structure.
         *   * SPECIAL_FOLDER_PROPS: A SpecialFolderDataBlock structure.
         *   * TRACKER_PROPS: A TrackerDataBlock structure.
         *   * VISTA_AND_ABOVE_IDLIST_PROPS: A VistaAndAboveIDListDataBlock structure.
         *   * TERMINAL_BLOCK A structure that indicates the end of the extra data section.
         *
         * All data fields are stored in little-endian format.
         */

    #pragma pack(push, 1)

        /**
         * This structure defines bits that specify which shell link structures are present in the file
         * format after the shlink_header_t structure.
         */
        enum shlink_flags_t
        {
            //! The shell link is saved with an item ID list (IDList). If this bit is set, a
            //! shlink_target_idlist_t structure MUST follow the shlink_header_t.
            //! If this bit is not set, this structure MUST NOT be present.
            SHLINK_HAS_LINK_TARGET_IDLIST           = 1 << 0,

            //! The shell link is saved with link information. If this bit is set, a link_info_t
            //! structure MUST be present. If this bit is not set, this structure MUST NOT be present.
            SHLINK_HAS_LINK_INFO                    = 1 << 1,

            //! The shell link is saved with a name string. If this bit is set, a NAME_STRING StringData
            //! structure MUST be present. If this bit is not set, this structure MUST NOT be present.
            SHLINK_HAS_NAME                         = 1 << 2,

            //! The shell link is saved with a relative path string. If this bit is set, a RELATIVE_PATH
            //! StringData structure MUST be present. If this bit is not set, this structure MUST NOT be present.
            SHLINK_HAS_RELATIVE_PATH                = 1 << 3,

            //! The shell link is saved with a working directory string. If this bit is set, a
            //! WORKING_DIR StringData structure MUST be present. If this bit is not set, this structure
            //! MUST NOT be present.
            SHLINK_HAS_WORKING_DIR                  = 1 << 4,

            //! The shell link is saved with command line arguments. If this bit is set, a
            //! COMMAND_LINE_ARGUMENTS StringData structure MUST be present. If this bit is not set,
            //! this structure MUST NOT be present.
            SHLINK_HAS_ARGUMENTS                    = 1 << 5,

            //! The shell link is saved with an icon location string. If this bit is set, an
            //! ICON_LOCATION StringData structure MUST be present. If this bit is not set,
            //! this structure MUST NOT be present.
            SHLINK_HAS_ICON_LOCATION                = 1 << 6,

            //! The shell link contains Unicode encoded strings. This bit SHOULD be set. If this bit is set,
            //! the StringData section contains Unicode-encoded strings; otherwise, it contains strings that
            //! are encoded using the system default code page.
            SHLINK_IS_UNICODE                       = 1 << 7,

            //! The link_info_t structure is ignored.
            SHLINK_FORCE_NO_LINK_INFO               = 1 << 8,

            //! The shell link is saved with an EnvironmentVariableDataBlock.
            SHLINK_HAS_EXP_STRING                   = 1 << 9,

            //! The target is run in a separate virtual machine when launching a link target that is a 16-bit application.
            SHLINK_RUN_IN_SEPARATE_PROCESS          = 1 << 10,

            //! The shell link is saved with a DarwinDataBlock.
            SHLINK_HAS_DARWIN_ID                    = 1 << 12,

            //! The application is run as a different user when the target of the shell link is activated.
            SHLINK_RUN_AS_USER                      = 1 << 13,

            //! The shell link is saved with an IconEnvironmentDataBlock.
            SHLINK_HAS_EXP_ICON                     = 1 << 14,

            //! The file system location is represented in the shell namespace when the path to an item is parsed into an IDList.
            SHLINK_NO_PIDL_ALIAS                    = 1 << 15,

            //! The shell link is saved with a ShimDataBlock.
            SHLINK_RUN_WITH_SHIM_LAYER              = 1 << 17,

            //! The TrackerDataBlock is ignored.
            SHLINK_FORCE_NO_LINK_TRACK              = 1 << 18,

            //! The shell link attempts to collect target properties and store them in the
            //! PropertyStoreDataBlock when the link target is set.
            SHLINK_ENABLE_TARGET_METADATA           = 1 << 19,

            //! The EnvironmentVariableDataBlock is ignored.
            SHLINK_DISABLE_LINK_PATH_TRACKING       = 1 << 20,

            //! The SpecialFolderDataBlock and the KnownFolderDataBlock are ignored when loading
            //! the shell link. If this bit is set, these extra data blocks SHOULD NOT be saved when
            //! saving the shell link.
            SHLINK_DISABLE_KNOWN_FOLDER_TRACKING    = 1 << 21,

            //! If the link has a KnownFolderDataBlock, the unaliased form
            //! of the known folder IDList SHOULD be used when translating the target
            //! IDList at the time that the link is loaded.
            SHLINK_DISABLE_KNOWN_FOLDER_ALIAS       = 1 << 22,

            //! Creating a link that references another link is enabled. Otherwise, specifying a link as
            //! the target IDList SHOULD NOT be allowed.
            SHLINK_ALLOW_LINK_TO_LINK               = 1 << 23,

            //! When saving a link for which the target IDList is under a known folder,
            //! either the unaliased form of that known folder or the target IDList SHOULD be used.
            SHLINK_UNALIAS_ON_SAVE                  = 1 << 24,

            //! The target IDList SHOULD NOT be stored; instead, the path specified in the
            //! EnvironmentVariableDataBlock (section 2.5.4) SHOULD be used to refer to the target.
            SHLINK_PREFER_ENVIRONMENT_PATH          = 1 << 25,

            //! When the target is a UNC name that refers to a location on a local machine, the local
            //! path IDList in the PropertyStoreDataBlock SHOULD be stored, so it can be used when the
            //! link is loaded on the local machine.
            SHLINK_KEEP_LOCAL_IDLIST_FOR_UNC_TARGET = 1 << 26,
        };

        /**
         * The expected window state of an application launched by the link.
         */
        enum shlink_show_t
        {
            //! The application is open and its window is open in a normal fashion.
            SHLINK_SW_SHOWNORMAL        = 0x00000001,

            //! The application is open, and keyboard focus is given to the application, but its window is not shown.
            SHLINK_SW_SHOWMAXIMIZED     = 0x00000003,

            //! The application is open, but its window is not shown. It is not given the keyboard focus.
            SHLINK_SW_SHOWMINNOACTIVE   = 0x00000007,
        };

        /**
         * This structure defines bits that specify the file attributes of the link target,
         * if the target is a file system item. File attributes can be used if the link target is not available,
         * or if accessing the target would be inefficient. It is possible for the target items attributes to be
         * out of sync with this value.
         */
        enum shlink_file_attributes_t
        {
            //! The file or directory is read-only. For a file, if this bit is set,
            //! applications can read the file but cannot write to it or delete
            //! it. For a directory, if this bit is set, applications cannot delete
            //! the directory.
            SHLINK_FILE_ATTRIBUTE_READONLY      = 1 << 0,

            //! The file or directory is hidden. If this bit is set, the file or
            //! folder is not included in an ordinary directory listing.
            SHLINK_FILE_ATTRIBUTE_HIDDEN        = 1 << 1,

            //! The file or directory is part of the operating system or is used
            //! exclusively by the operating system.
            SHLINK_FILE_ATTRIBUTE_SYSTEM        = 1 << 2,

            //! The link target is a directory instead of a file.
            SHLINK_FILE_ATTRIBUTE_DIRECTORY     = 1 << 4,

            //! The file or directory is an archive file. Applications use this
            //! flag to mark files for backup or removal.
            SHLINK_FILE_ATTRIBUTE_ARCHIVE       = 1 << 5,

            //! The file or directory has no other flags set. If this bit is 1, all
            //! other bits in this structure MUST be clear.
            SHLINK_FILE_ATTRIBUTE_NORMAL        = 1 << 7,

            //! The file is being used for temporary storage.
            SHLINK_FILE_ATTRIBUTE_TEMPORARY     = 1 << 8,

            //! The file is a sparse file.
            SHLINK_FILE_ATTRIBUTE_SPARSE_FILE   = 1 << 9,

            //! The file or directory has an associated reparse point.
            SHLINK_FILE_ATTRIBUTE_REPARSE_POINT = 1 << 10,

            //! The file or directory is compressed. For a file, this means that
            //! all data in the file is compressed. For a directory, this means
            //! that compression is the default for newly created files and
            //! subdirectories.
            SHLINK_FILE_ATTRIBUTE_COMPRESSED    = 1 << 11,

            //! The data of the file is not immediately available.
            SHLINK_FILE_ATTRIBUTE_OFFLINE       = 1 << 12,

            //! The contents of the file need to be indexed.
            SHLINK_FILE_ATTRIBUTE_NOT_CONTENT_INDEXED   = 1 << 13,

            //! The file or directory is encrypted. For a file, this means that
            //! all data in the file is encrypted. For a directory, this means
            //! that encryption is the default for newly created files and
            //! subdirectories.
            SHLINK_FILE_ATTRIBUTE_ENCRYPTED     = 1 << 14,
        };

        /**
         * This structure specifies input generated by a combination of keyboard
         * keys being pressed.
         */
        enum shlink_hotkey_t
        {
            //! The key mask for the key scan code.
            SHLINK_HOTKEY_KEY_MASK              = 0xff,

            //! The "SHIFT" key on the keyboard.
            SHLINK_HOTKEY_SHIFT                 = 1 << 8,

            //! The "CTRL" key on the keyboard.
            SHLINK_HOTKEY_CONTROL               = 1 << 9,

            //! The "ALT" key on the keyboard.
            SHLINK_HOTKEY_ALT                   = 1 << 10,
        };

        /**
         * Flags that specify whether the VolumeID, LocalBasePath,
         * LocalBasePathUnicode, and CommonNetworkRelativeLink fields are present in
         * shlink_link_info structure.
         */
        enum shlink_link_info_flags_t
        {
            /**
             * If set, the VolumeID and LocalBasePath fields are present,
             * and their locations are specified by the values of the
             * VolumeIDOffset and LocalBasePathOffset fields,
             * respectively. If the value of the LinkInfoHeaderSize field is
             * greater than or equal to 0x00000024, the
             * LocalBasePathUnicode field is present, and its location is
             * specified by the value of the LocalBasePathOffsetUnicode field.
             * If not set, the VolumeID, LocalBasePath, and
             * LocalBasePathUnicode fields are not present, and the
             * values of the VolumeIDOffset and LocalBasePathOffset
             * fields are zero. If the value of the LinkInfoHeaderSize field
             * is greater than or equal to 0x00000024, the value of the
             * LocalBasePathOffsetUnicode field is zero.
             */
            SHLINK_LINK_INFO_VOLUME_ID_AND_LOCAL_BASE_PATH                  = 1 << 0,

            /**
             * If set, the CommonNetworkRelativeLink field is present,
             * and its location is specified by the value of the
             * CommonNetworkRelativeLinkOffset field.
             * If not set, the CommonNetworkRelativeLink field is not
             * present, and the value of the CommonNetworkRelativeLinkOffset field is zero.
             */
            SHLINK_LINK_INFO_COMMON_NETWORK_RELATIVE_LINK_AND_PATH_SUFFIX   = 1 << 1,
        };

        /**
         * Drive type for the shell link
         */
        enum shlink_drive_type_t
        {
            //! The drive type cannot be determined.
            SHLINK_DRIVE_UNKNOWN        = 0x00000000,

            //! The root path is invalid; for example, there is no volume mounted at the path.
            SHLINK_DRIVE_NO_ROOT_DIR    = 0x00000001,

            //! The drive has removable media, such as a floppy drive, thumb drive, or flash card reader.
            SHLINK_DRIVE_REMOVABLE      = 0x00000002,

            //! The drive has fixed media, such as a hard drive or flash drive.
            SHLINK_DRIVE_FIXED          = 0x00000003,

            //! The drive is a remote (network) drive.
            SHLINK_DRIVE_REMOTE         = 0x00000004,

            //! The drive is a CD-ROM drive.
            SHLINK_DRIVE_CDROM          = 0x00000005,

            //! The drive is a RAM disk.
            SHLINK_DRIVE_RAMDISK        = 0x00000006,
        };

        /**
         * Flags that specify the contents of the DeviceNameOffset and NetProviderType fields.
         */
        enum shlink_common_network_relative_link_flags_t
        {
            //! If set, the DeviceNameOffset field contains an offset to the device name.
            //! If not set, the DeviceNameOffset field does not contain an offset to the device name, and
            //! its value MUST be zero.
            SHLINK_NET_VALID_DEVICE             = 1 << 0,

            //! If set, the NetProviderType field contains the network provider type.
            //! If not set, the NetProviderType field does not contain the network provider type, and its
            //! value MUST be zero.
            SHLINK_NET_VALID_NET_TYPE           = 1 << 1,
        };

        /**
         * Network provider type
         */
        enum shlink_network_provider_t
        {
            SHLINK_WNNC_NET_AVID                = 0x001A0000,
            SHLINK_WNNC_NET_DOCUSPACE           = 0x001B0000,
            SHLINK_WNNC_NET_MANGOSOFT           = 0x001C0000,
            SHLINK_WNNC_NET_SERNET              = 0x001D0000,
            SHLINK_WNNC_NET_RIVERFRONT1         = 0x001E0000,
            SHLINK_WNNC_NET_RIVERFRONT2         = 0x001F0000,
            SHLINK_WNNC_NET_DECORB              = 0x00200000,
            SHLINK_WNNC_NET_PROTSTOR            = 0x00210000,
            SHLINK_WNNC_NET_FJ_REDIR            = 0x00220000,
            SHLINK_WNNC_NET_DISTINCT            = 0x00230000,
            SHLINK_WNNC_NET_TWINS               = 0x00240000,
            SHLINK_WNNC_NET_RDR2SAMPLE          = 0x00250000,
            SHLINK_WNNC_NET_CSC                 = 0x00260000,
            SHLINK_WNNC_NET_3IN1                = 0x00270000,
            SHLINK_WNNC_NET_EXTENDNET           = 0x00290000,
            SHLINK_WNNC_NET_STAC                = 0x002A0000,
            SHLINK_WNNC_NET_FOXBAT              = 0x002B0000,
            SHLINK_WNNC_NET_YAHOO               = 0x002C0000,
            SHLINK_WNNC_NET_EXIFS               = 0x002D0000,
            SHLINK_WNNC_NET_DAV                 = 0x002E0000,
            SHLINK_WNNC_NET_KNOWARE             = 0x002F0000,
            SHLINK_WNNC_NET_OBJECT_DIRE         = 0x00300000,
            SHLINK_WNNC_NET_MASFAX              = 0x00310000,
            SHLINK_WNNC_NET_HOB_NFS             = 0x00320000,
            SHLINK_WNNC_NET_SHIVA               = 0x00330000,
            SHLINK_WNNC_NET_IBMAL               = 0x00340000,
            SHLINK_WNNC_NET_LOCK                = 0x00350000,
            SHLINK_WNNC_NET_TERMSRV             = 0x00360000,
            SHLINK_WNNC_NET_SRT                 = 0x00370000,
            SHLINK_WNNC_NET_QUINCY              = 0x00380000,
            SHLINK_WNNC_NET_OPENAFS             = 0x00390000,
            SHLINK_WNNC_NET_AVID1               = 0X003A0000,
            SHLINK_WNNC_NET_DFS                 = 0x003B0000,
            SHLINK_WNNC_NET_KWNP                = 0x003C0000,
            SHLINK_WNNC_NET_ZENWORKS            = 0x003D0000,
            SHLINK_WNNC_NET_DRIVEONWEB          = 0x003E0000,
            SHLINK_WNNC_NET_VMWARE              = 0x003F0000,
            SHLINK_WNNC_NET_RSFX                = 0x00400000,
            SHLINK_WNNC_NET_MFILES              = 0x00410000,
            SHLINK_WNNC_NET_MS_NFS              = 0x00420000,
            SHLINK_WNNC_NET_GOOGLE              = 0x00430000,
        };

        /**
         * Console color fill attributes
         */
        enum shlink_fill_attributes_t
        {
            //! The foreground text color contains blue.
            SHLINK_FOREGROUND_BLUE      = 0x0001,

            //! The foreground text color contains green.
            SHLINK_FOREGROUND_GREEN     = 0x0002,

            //! The foreground text color contains red.
            SHLINK_FOREGROUND_RED       = 0x0004,

            //! The foreground text color is intensified.
            SHLINK_FOREGROUND_INTENSITY = 0x0008,

            //! The background text color contains blue.
            SHLINK_BACKGROUND_BLUE      = 0x0010,

            //! The background text color contains green.
            SHLINK_BACKGROUND_GREEN     = 0x0020,

            //! The background text color contains red.
            SHLINK_BACKGROUND_RED       = 0x0040,

            //! The background text color is intensified.
            SHLINK_BACKGROUND_INTENSITY = 0x0080,
        };

        /**
         * Font family
         */
        enum shlink_font_family_t
        {
            //! The font family is unknown.
            SHLINK_FF_DONTCARE          = 0x0000,

            //! The font is variable-width with serifs; for example, "Times New Roman".
            SHLINK_FF_ROMAN             = 0x0010,

            //! The font is variable-width without serifs; for example, "Arial".
            SHLINK_FF_SWISS             = 0x0020,

            //! The font is fixed-width, with or without serifs; for example, "Courier New".
            SHLINK_FF_MODERN            = 0x0030,

            //! The font is designed to look like handwriting; for example, "Cursive".
            SHLINK_FF_SCRIPT            = 0x0040,

            //! The font is a novelty font; for example, "Old English".
            SHLINK_FF_DECORATIVE        = 0x0050,

            //! A font pitch does not apply.
            SHLINK_TMPF_NONE            = 0x0000,

            //! The font is a fixed-pitch font.
            SHLINK_TMPF_FIXED_PITCH     = 0x0001,

            //! The font is a vector font.
            SHLINK_TMPF_VECTOR          = 0x0002,

            //! The font is a true-type font.
            SHLINK_TMPF_TRUETYPE        = 0x0004,

            //! The font is specific to the device.
            SHLINK_TMPF_DEVICE          = 0x0008,
        };

        //! Different signatures for different data blocks
        enum shlink_data_block_signature_t
        {
            //! Signature of the Console data block
            SHLINK_CONSOLE_DATA_BLOCK           = 0xA0000002,

            //! Signature of the Tracker data block
            SHLINK_TRACKER_DATA_BLOCK           = 0xA0000003,

            //! Signature of the ConsoleFE data block
            SHLINK_CONSOLE_FE_DATA_BLOCK        = 0xA0000004,

            //! Signature of the SpecialFolder data block
            SHLINK_SPECIAL_FOLDER_DATA_BLOCK    = 0xA0000005,

            //! Signature of the Darwin data block
            SHLINK_DARWIN_DATA_BLOCK            = 0xA0000006,

            //! Signature of the IconEnvironment data block
            SHLINK_ICON_ENVIRONMENT_DATA_BLOCK  = 0xA0000007,

            //! Signature of the Shim data block
            SHLINK_SHIM_DATA_BLOCK              = 0xA0000008,

            //! Signature of the PropertyStore data block
            SHLINK_PROPERTY_STORE_DATA_BLOCK    = 0xA0000009,

            //! Signature of the KnownFolder data block
            SHLINK_KNOWN_FOLDER_DATA_BLOCK      = 0xA000000B,

            //! Signature of the IDList data block (for Vista and above)
            SHLINK_IDLIST_DATA_BLOCK            = 0xA000000C,
        };

        /**
         * The file time in UTC (Coordinated Universal Time). Contains a 64-bit value representing the number of
         * 100-nanosecond intervals since January 1, 1601 (UTC).
         */
        typedef struct shlink_filetime_t
        {
            //! The low-order part of the file time.
            uint32_t            loword;
            //! The high-order part of the file time.
            uint32_t            hiword;

        } shlink_filetime_t;

        /**
         * Class identifier (CLSID) data structure / GUID data structure
         */
        typedef struct shlink_guid_t
        {
            uint32_t            parts[4];
        } shlink_guid_t;

        /**
         * Mandatory header of the Shell Link (*.lnk) file.
         */
        typedef struct shlink_header_t
        {
            //! The size, in bytes, of this structure. This value MUST be 0x0000004C.
            uint32_t            size;

            //! A class identifier (CLSID). This value MUST be 00021401-0000-0000-C000-000000000046.
            shlink_guid_t       clsid;

            //! A shlink_flags_t structure that specifies information about the shell
            //! link and the presence of optional portions of the structure.
            uint32_t            flags;

            //! A shlink_file_attributes_flags_t structure that specifies information about the link target.
            uint32_t            file_attributes;

            //! A FILETIME structure that specifies the creation time of the link target in UTC (Coordinated
            //! Universal Time). If the value is zero, there is no creation time set on the link target.
            shlink_filetime_t   creation_time;

            //! A FILETIME structure that specifies the access time of the link target in UTC (Coordinated
            //! Universal Time). If the value is zero, there is no access time set on the link target.
            shlink_filetime_t   access_time;

            //! A FILETIME structure that specifies the write time of the link target in UTC (Coordinated
            //! Universal Time). If the value is zero, there is no write time set on the link target.
            shlink_filetime_t   write_time;

            //! A 32-bit unsigned integer that specifies the size, in bytes, of the link target. If the link
            //! target file is larger than 0xFFFFFFFF, this value specifies the least significant 32 bits of the
            //! link target file size.
            uint32_t            file_size;

            //! A 32-bit signed integer that specifies the index of an icon within a given icon location.
            uint32_t            icon_index;

            //! A 32-bit unsigned integer that specifies the expected window state of an
            //! application launched by the link. This value SHOULD be one of the shlink_show_t constants.
            //! All other values MUST be treated as SHLINK_SW_SHOWNORMAL.
            uint32_t            show_command;

            //! A shlink_hotkey_t structure that specifies the keystrokes used to launch the application
            //! referenced by the shortcut key. This value is assigned to the application.
            uint16_t            hotkey;

            //! A value that MUST be zero.
            uint16_t            reserved1;

            //! A value that MUST be zero.
            uint32_t            reserved2;

            //! A value that MUST be zero.
            uint32_t            reserved3;

        } shlink_header_t;

        /**
         * An shlink_itemid_t is an element in an shlink_idlist_t structure. The data stored in a given ItemID is
         * defined by the source that corresponds to the location in the target namespace of the preceding
         * ItemIDs. This data uniquely identifies the items in that part of the namespace.
         */
        typedef struct shlink_itemid_t
        {
            //! A 16-bit, unsigned integer that specifies the size, in bytes, of the ItemID
            //! structure, including the ItemIDSize field.
            uint16_t            size;

            //! The shell data source-defined data that specifies an item.
            uint8_t             data[];

        } shlink_itemid_t;

        /**
         * This structure specifies the target of the link. The presence of this optional structure
         * is specified by the SHLINK_HAS_LINK_TARGET_IDLIST bit in the shlink_header_t structure.
         */
        typedef struct shlink_idlist_t
        {
            //! The size, in bytes, of the idlist field.
            uint16_t            size;

            //! A stored sequence of shlink_itemid_t structures, which conforms to the following ABNF [RFC5234]:
            //!   IDLIST = *ITEMID TERMINALID
            shlink_itemid_t     items[];

        } shlink_idlist_t, shlink_target_idlist_t;

        /**
         * The VolumeID structure specifies information about the volume that a link target was on when the
         * link was created. This information is useful for resolving the link if the file is not found in its
         * original location.
         */
        typedef struct shlink_volume_id_t
        {
            //! A 32-bit, unsigned integer that specifies the size, in bytes, of this structure.
            //! This value MUST be greater than 0x00000010. All offsets specified in this structure
            //! MUST be less than this value, and all strings contained in this structure MUST fit
            //! within the extent defined by this size.
            uint32_t            size;

            //! A 32-bit, unsigned integer that specifies the type of drive the link target is
            //! stored on. This value MUST be one of the shlink_drive_type_t values.
            uint32_t            drive_type;

            //! A 32-bit, unsigned integer that specifies the drive serial number of the volume the
            //! link target is stored on.
            uint32_t            drive_serial;

            //! A 32-bit, unsigned integer that specifies the location of a string that contains the
            //! volume label of the drive that the link target is stored on. This value is an offset, in
            //! bytes, from the start of the VolumeID structure to a NULL-terminated string of characters, defined
            //! by the system default code page. The volume label string is located in the Data field of this
            //! structure. If the value of the VolumeLabelOffset field is not 0x00000014, this field MUST NOT be present;
            //! instead, the value of the VolumeLabelOffset field MUST be used to locate the volume label string.
            uint32_t            volume_label_offset;

            //! A buffer of data that contains the volume label of the drive as a string defined by the
            //! system default code page or Unicode characters, as specified by preceding fields.
            uint8_t             data[];

        } shlink_volume_id_t;

        /**
         * This structure specifies information necessary to resolve a link target if it is not found in its
         * original location. This includes information about the volume that the target was stored on, the
         * mapped drive letter, and a Universal Naming Convention (UNC) form of the path if one existed
         * when the link was created. For more details about UNC paths.
         */
        typedef struct shlink_link_info_t
        {
            //! A 32-bit, unsigned integer that specifies the size, in bytes, of the LinkInfo
            //! structure. All offsets specified in this structure MUST be less than this value, and all strings
            //! contained in this structure MUST fit within the extent defined by this size.
            uint32_t            size;

            //! A 32-bit, unsigned integer that specifies the size, in bytes, of the
            //! LinkInfo header section, which is composed of the LinkInfoSize, LinkInfoHeaderSize,
            //! LinkInfoFlags, VolumeIDOffset, LocalBasePathOffset, CommonNetworkRelativeLinkOffset,
            //! CommonPathSuffixOffset fields, and, if included, the LocalBasePathOffsetUnicode and
            //! CommonPathSuffixOffsetUnicode fields.
            //! Value Meaning
            //!   * 0x0000001C Offsets to the optional fields are not specified.
            //!   * 0x00000024 <= value Offsets to the optional fields are specified.
            uint32_t            header_size;

            //! Flags that specify whether the VolumeID, LocalBasePath,
            //! LocalBasePathUnicode, and CommonNetworkRelativeLink fields are present in this
            //! structure.
            uint32_t            flags;

            //! A 32-bit, unsigned integer that specifies the location of the VolumeID
            //! field. If the SHLINK_LINK_INFO_VOLUME_ID_AND_LOCAL_BASE_PATH flag is set, this value
            //! is an offset, in bytes, from the start of the LinkInfo structure;
            //! otherwise, this value MUST be zero.
            uint32_t            volume_id_offset;

            //! A 32-bit, unsigned integer that specifies the location of the
            //! LocalBasePath field. If the VolumeIDAndLocalBasePath flag is set, this value is an offset, in
            //! bytes, from the start of the LinkInfo structure; otherwise, this value MUST be zero.
            uint32_t            local_base_path_offset;

            //! A 32-bit, unsigned integer that specifies the location of the CommonNetworkRelativeLink field. If the
            //! SHLINK_LINK_INFO_COMMON_NETWORK_RELATIVE_LINK_AND_PATH_SUFFIX flag is set, this value is an offset,
            //! in bytes, from the start of the LinkInfo structure; otherwise, this value MUST be zero.
            uint32_t            common_network_relative_link_offset;

            //! A 32-bit, unsigned integer that specifies the location of the CommonPathSuffix field.
            //! This value is an offset, in bytes, from the start of the LinkInfo structure.
            uint32_t            common_path_suffix_offset;

        } shlink_link_info_t;

        /**
         * Optional part of shlink_link_info_t
         */
        typedef struct shlink_link_info_opt_t
        {
            //! An optional, 32-bit, unsigned integer that specifies the location of the LocalBasePathUnicode field.
            //! If the VolumeIDAndLocalBasePath flag is set, this value is an offset, in bytes, from the start of the
            //! LinkInfo structure; otherwise, this value MUST be zero. This field can be present only if the value of
            //! the LinkInfoHeaderSize field is greater than or equal to 0x00000024.
            uint32_t            local_base_path_offset_unicode;

            //! An optional, 32-bit, unsigned integer that specifies the location of the CommonPathSuffixUnicode field.
            //! This value is an offset, in bytes, from the start of the LinkInfo structure. This field can be present only
            //! if the value of the LinkInfoHeaderSize field is greater than or equal to 0x00000024
            uint32_t            local_base_path_suffix_offset_unicode;

        } shlink_link_info_opt_t;

        /**
         * The CommonNetworkRelativeLink structure specifies information about the network location where a
         * link target is stored, including the mapped drive letter and the UNC path prefix.
         */
        typedef struct shlink_common_network_relative_link_t
        {
            //! A 32-bit, unsigned integer that specifies the size, in
            //! bytes, of the shlink_common_network_relative_link_t structure. This value MUST be greater than or equal to
            //! 0x00000014. All offsets specified in this structure MUST be less than this value, and all strings
            //! contained in this structure MUST fit within the extent defined by this size.
            uint32_t            size;

            //! Flags that specify the contents of the DeviceNameOffset and NetProviderType fields.
            uint32_t            flags;

            //! A 32-bit, unsigned integer that specifies the location of the NetName
            //! field. This value is an offset, in bytes, from the start of the CommonNetworkRelativeLink structure.
            uint32_t            net_name_offset;

            //! (4 bytes): A 32-bit, unsigned integer that specifies the location of the
            //! DeviceName field. If the ValidDevice flag is set, this value is an offset, in bytes, from the start
            //! of the CommonNetworkRelativeLink structure; otherwise, this value MUST be zero.
            uint32_t            device_name_offset;

            //! A 32-bit, unsigned integer that specifies the type of network provider. If the ValidNetType flag is set,
            //! this value MUST be one of the shlink_network_provider_type_t values; otherwise, this value MUST be ignored.
            uint32_t            network_provider_type;

            //! An optional, 32-bit, unsigned integer that specifies the location of the NetNameUnicode field.
            //! This value is an offset, in bytes, from the start of the CommonNetworkRelativeLink structure. This field
            //! MUST be present if the value of the NetNameOffset field is greater than 0x00000014; otherwise,
            //! this field MUST NOT be present.
            uint32_t            net_name_offset_unicode;

            //! An optional, 32-bit, unsigned integer that specifies the location of the DeviceNameUnicode field.
            //! This value is an offset, in bytes, from the start of the CommonNetworkRelativeLink structure. This
            //! field MUST be present if the value of the NetNameOffset field is greater than 0x00000014; otherwise,
            //! this field MUST NOT be present. NetName (variable): A NULL–terminated string, as defined by the system
            //! default code page, which specifies a server share path; for example, "\\server\share".
            uint32_t            device_name_offset_unicode;

        } shlink_common_network_relative_link_t;

        /**
         * StringData refers to a set of structures that convey user interface and path identification information.
         */
        typedef struct shlink_string_data_t
        {
            //! A 16-bit, unsigned integer that specifies either the number of characters, defined by the system
            //! default code page, or the number of Unicode characters found in the String field. A value of zero
            //! specifies an empty string.
            uint16_t        length;

            //! An optional set of characters, defined by the system default code page, or a Unicode string with a
            //! length specified by the length field. This string MUST NOT be NULL-terminated.
            uint8_t         data[];
        } shlink_string_data_t;

        /**
         * The ConsoleDataBlock structure specifies the display settings to use when a link target specifies an
         * application that is run in a console window.
         */
        typedef struct shlink_conosole_data_block_t
        {
            //! A 32-bit, unsigned integer that specifies the size of the shlink_conosole_data_block_t
            //! structure. This value MUST be 0x000000CC.
            uint32_t        size;

            //! A 32-bit, unsigned integer that specifies the signature of the
            //! shlink_conosole_data_block_t extra data section. This value MUST be 0xA0000002.
            uint32_t        signature;

            //! A 16-bit, unsigned integer that specifies the fill attributes that control the foreground and background
            //! text colors in the console window.
            uint16_t        fill_attributes;

            //! A 16-bit, unsigned integer that specifies the fill attributes that control the foreground and background
            //! text color in the console window popup. The values are the same as for the FillAttributes field.
            uint16_t        popup_fill_attributes;

            //! A 16-bit, signed integer that specifies the horizontal size (X axis), in characters, of the console window buffer.
            int16_t         screen_buffer_size_x;

            //! A 16-bit, signed integer that specifies the vertical size (Y axis), in characters, of the console window buffer.
            int16_t         screen_buffer_size_y;

            //! A 16-bit, signed integer that specifies the horizontal size (X axis), in characters, of the console window.
            int16_t         window_size_x;

            //! A 16-bit, signed integer that specifies the vertical size (Y axis), in characters, of the console window.
            int16_t         window_size_y;

            //! A 16-bit, signed integer that specifies the horizontal coordinate (X axis), in pixels, of the console window origin.
            int16_t         window_origin_x;

            //! A 16-bit, signed integer that specifies the vertical coordinate (Y axis), in pixels, of the console window origin.
            int16_t         window_origin_y;

            //! A value that is undefined and MUST be ignored.
            uint32_t        unused1;

            //! A value that is undefined and MUST be ignored.
            uint32_t        unused2;

            //! A 32-bit, unsigned integer that specifies the size, in pixels, of the font used in
            //! the console window. The two most significant bytes contain the font height and the two least
            //! significant bytes contain the font width. For vector fonts, the width is set to zero.
            uint32_t        font_size;

            //! A 32-bit, unsigned integer that specifies the family of the font used in the console window.
            //! This value MUST be comprised of a font family and a font pitch. The values for the font family are
            //! listed in shlink_font_family_t.
            uint32_t        font_family;

            //! A 32-bit, unsigned integer that specifies the stroke weight of the font used in the console window.
            //! Value Meaning:
            //!   700 <= value: A bold font.
            //!   value < 700:  A regular-weight font.
            uint32_t        font_weight;

            //! A 32-character Unicode string that specifies the face name of the font used in the console window.
            lsp_utf16_t     face_name[32];

            //! A 32-bit, unsigned integer that specifies the size of the cursor, in pixels, used in the console window.
            //! Value Meaning:
            //! value <= 25:  A small cursor.
            //! 26 — 50:      A medium cursor.
            //! 51 — 100:     A large cursor.
            uint32_t        cursor_size;

            //! A 32-bit, unsigned integer that specifies whether to open the console window in full-screen mode.
            //! Value Meaning:
            //! 0x00000000:         Full-screen mode is off.
            //! 0x00000000 < value: Full-screen mode is on.
            uint32_t        full_screen;

            //! A 32-bit, unsigned integer that specifies whether to open the console window in QuikEdit mode.
            //! In QuickEdit mode, the mouse can be used to cut, copy, and paste text in the console window.
            //! Value Meaning:
            //! 0x00000000:         QuikEdit mode is off.
            //! 0x00000000 < value: QuikEdit mode is on.
            uint32_t        quick_edit;

            //! A 32-bit, unsigned integer that specifies auto-position mode of the console window.
            //! Value Meaning:
            //! 0x00000000:         The values of the WindowOriginX and WindowOriginY fields are used to
            //!                     position the console window.
            //! 0x00000000 < value: The console window is positioned automatically.
            uint32_t        auto_position;

            //! A 32-bit, unsigned integer that specifies the size, in characters, of the buffer that is used
            //! to store a history of user input into the console window.
            uint32_t        history_buffer_size;

            //! A 32-bit, unsigned integer that specifies the number of history buffers to use.
            uint32_t        number_of_history_buffers;

            //! A 32-bit, unsigned integer that specifies whether to remove duplicates in the history buffer.
            //! Value Meaning:
            //! 0x00000000:         Duplicates are not allowed.
            //! 0x00000000 < value: Duplicates are allowed.
            uint32_t        history_no_dup;

            //! A table of 16 32-bit, unsigned integers specifying the RGB colors that are used for text in the
            //! console window. The values of the fill attribute fields FillAttributes and PopupFillAttributes are
            //! used as indexes into this table to specify the final foreground and background color for a character.
            uint32_t        color_table[16];

        } shlink_conosole_data_block_t;

        /**
         * The ConsoleFEDataBlock structure specifies the code page to use for displaying text when a link
         * target specifies an application that is run in a console window.
         */
        typedef struct shlink_conosole_fe_data_block_t
        {
            //! A 32-bit, unsigned integer that specifies the size of the shlink_conosole_fe_data_block_t
            //! structure. This value MUST be 0x0000000C.
            uint32_t        size;

            //! A 32-bit, unsigned integer that specifies the signature of the
            //! shlink_conosole_fe_data_block_t extra data section. This value MUST be 0xA0000004.
            uint32_t        signature;

            //! A 32-bit, unsigned integer that specifies a code page language code identifier.
            uint32_t        code_page;
        } shlink_conosole_fe_data_block_t;

        /**
         * The DarwinDataBlock structure specifies an application identifier that can be used instead of a link
         * target IDList to install an application when a shell link is activated.
         */
        typedef struct shlink_darwin_data_block_t
        {
            //! A 32-bit, unsigned integer that specifies the size of the shlink_darwin_data_block_t
            //! structure. This value MUST be 0x00000314.
            uint32_t        size;

            //! A 32-bit, unsigned integer that specifies the signature of the
            //! shlink_darwin_data_block_t extra data section. This value MUST be 0xA0000006.
            uint32_t        signature;

            //! A NULL–terminated string, defined by the system default code page, which specifies an application identifier.
            //! This field SHOULD be ignored.
            uint8_t         ansi[260];

            //! An optional, NULL–terminated, Unicode string that specifies an application identifier.
            lsp_utf16_t     unicode[260];
        } shlink_darwin_data_block_t;

        /**
         * The IconEnvironmentDataBlock structure specifies the path to an icon. The path is encoded using
         * environment variables, which makes it possible to find the icon across machines where the locations
         * vary but are expressed using environment variables.
         */
        typedef struct shlink_icon_environment_data_block_t
        {
            //! A 32-bit, unsigned integer that specifies the size of the shlink_icon_environment_data_block_t
            //! structure. This value MUST be 0x00000314.
            uint32_t        size;

            //! A 32-bit, unsigned integer that specifies the signature of the
            //! shlink_icon_environment_data_block_t extra data section. This value MUST be 0xA0000007.
            uint32_t        signature;

            //! A NULL-terminated string, defined by the system default code page, which
            //! specifies a path that is constructed with environment variables.
            uint8_t         ansi[260];

            //! An optional, NULL-terminated, Unicode string that specifies a path
            //! that is constructed with environment variables.
            lsp_utf16_t     unicode[260];
        } shlink_icon_environment_data_block_t;

        //! The KnownFolderDataBlock structure specifies the location of a known folder. This data can be used
        //! when a link target is a known folder to keep track of the folder so that the link target IDList can be
        //! translated when the link is loaded.
        typedef struct shlink_known_folder_data_block_t
        {
            //! A 32-bit, unsigned integer that specifies the size of the shlink_known_folder_data_block_t
            //! structure. This value MUST be 0x0000001C.
            uint32_t        size;

            //! A 32-bit, unsigned integer that specifies the signature of the shlink_known_folder_data_block_t
            //! extra data section. This value MUST be 0xA000000B.
            uint32_t        signature;

            //! A value in GUID packet representation that specifies the folder GUID ID.
            shlink_guid_t   known_folder_id;

            //! A 32-bit, unsigned integer that specifies the location of the ItemID of the first
            //! child segment of the IDList specified by KnownFolderID. This value is the offset, in bytes, into
            //! the link target IDList.
            uint32_t        offset;

        } shlink_known_folder_data_block_t;

        //! A PropertyStoreDataBlock structure specifies a set of properties that can be used by applications to
        //! store extra data in the shell link.
        typedef struct shlink_property_store_data_block_t
        {
            //! A 32-bit, unsigned integer that specifies the size of the property_store_data_block_t
            //! structure. This value MUST be greater than or equal to 0x0000000C.
            uint32_t        size;

            //! A 32-bit, unsigned integer that specifies the signature of the
            //! property_store_data_block_t extra data section. This value MUST be 0xA0000009.
            uint32_t        signature;

            //! A serialized property storage structure.
            uint8_t         data;

        } shlink_property_store_data_block_t;

        //! The ShimDataBlock structure specifies the name of a shim that can be applied when activating a link target.
        typedef struct shlink_shim_data_block_t
        {
            //! A 32-bit, unsigned integer that specifies the size of the shlink_shim_data_block_t structure.
            //! This value MUST be greater than or equal to 0x00000088.
            uint32_t        size;

            //! A 32-bit, unsigned integer that specifies the signature of the
            //! shlink_shim_data_block_t extra data section. This value MUST be 0xA0000008.
            uint32_t        signature;

            //! A Unicode string that specifies the name of a shim layer to apply to a link
            //! target when it is being activated.
            lsp_utf16_t     layer_name;

        } shlink_shim_data_block_t;

        //! The SpecialFolderDataBlock structure specifies the location of a special folder. This data can be used
        //! when a link target is a special folder to keep track of the folder, so that the link target IDList can be
        //! translated when the link is loaded.
        typedef struct shlink_special_folder_data_block_t
        {
            //! A 32-bit, unsigned integer that specifies the size of the shlink_special_folder_data_block_t
            //! structure. This value MUST be 0x00000010.
            uint32_t        size;

            //! A 32-bit, unsigned integer that specifies the signature of the
            //! shlink_special_folder_data_block_t extra data section. This value MUST be 0xA0000005.
            uint32_t        signature;

            //! A 32-bit, unsigned integer that specifies the folder integer ID.
            uint32_t        special_folder_id;

            //! A 32-bit, unsigned integer that specifies the location of the ItemID of the first
            //! child segment of the IDList specified by SpecialFolderID. This value is the offset, in bytes, into
            //! the link target IDList.
            uint32_t        offset;

        } shlink_special_folder_data_block_t;

        //! The TrackerDataBlock structure specifies data that can be used to resolve a link target if it is not
        //! found in its original location when the link is resolved. This data is passed to the Link Tracking service
        //! to find the link target.
        typedef struct shlink_tracker_data_block_t
        {
            //! A 32-bit, unsigned integer that specifies the size of the shlink_tracker_data_block_t
            //! structure. This value MUST be 0x00000060.
            uint32_t        size;

            //! A 32-bit, unsigned integer that specifies the signature of the
            //! shlink_tracker_data_block_t extra data section. This value MUST be 0xA0000003.
            uint32_t        signature;

            //! A 32-bit, unsigned integer that specifies the size of the rest of the
            //! shlink_tracker_data_block_t structure, including this Length field. This value MUST be 0x00000058.
            uint32_t        length;

            //! A 32-bit, unsigned integer. This value MUST be 0x00000000.
            uint32_t        version;

            //! A NULL–terminated character string, as defined by the system default code
            //! page, which specifies the NetBIOS name of the machine where the link target was last known to
            //! reside.
            char            machine_id[16];

            //! Two values in GUID packet representation ([MS-DTYP] section 2.3.4.2) that are
            //! used to find the link target with the Link Tracking service.
            shlink_guid_t   droid[2];

            //! Two values in GUID packet representation that are used to find the link
            //! target with the Link Tracking service.
            shlink_guid_t   droid_birth[2];

        } shlink_tracker_data_block_t;

        /**
         * The VistaAndAboveIDListDataBlock structure specifies an alternate IDList that can be used instead of
         * the LinkTargetIDList structure on platforms that support it.
         */
        typedef struct shlink_id_list_data_block_t
        {
            //! A 32-bit, unsigned integer that specifies the size of the
            //! shlink_id_list_data_block_t structure. This value MUST be greater than or equal to
            //! 0x0000000A.
            uint32_t        size;

            //! A 32-bit, unsigned integer that specifies the signature of the
            //! shlink_id_list_data_block_t extra data section. This value MUST be 0xA000000C.
            uint32_t        signature;

            //! An IDList structure
            shlink_idlist_t idlist;

        } shlink_id_list_data_block_t;


        LSP_RUNTIME_LIB_PUBLIC
        extern const shlink_guid_t      SHLINK_FILE_HEADER_GUID;

    #pragma pack(pop)

    } /* namespace lnk */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_LNK_TYPES_H_ */
